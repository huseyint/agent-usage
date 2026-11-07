use super::types::{Result, Session};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};

const TAIL_BYTES: u64 = 8 * 1024 * 1024;
const RECORD_BYTES: usize = 1024 * 1024;
const WORKING_SECONDS: i64 = 120;
const RECENT_SECONDS: i64 = 45;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    pub state: &'static str,
    pub observed_at: String,
    pub expires_at: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Working,
    Recent,
    Idle,
}
#[derive(Default)]
struct Tracker {
    phase: Option<Phase>,
    turn: Option<String>,
    at: Option<DateTime<Utc>>,
}
impl Tracker {
    fn record(&mut self, value: &Value, provider: &str, now: DateTime<Utc>) {
        if value["isSidechain"].as_bool() == Some(true) {
            return;
        }
        let Some(at) = value["timestamp"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc))
        else {
            return;
        };
        if at > now + Duration::seconds(5) {
            return;
        }
        let kind = value["type"].as_str().unwrap_or("");
        let payload = &value["payload"];
        let mut phase = None;
        if provider == "codex" {
            let event = payload["type"].as_str().unwrap_or("");
            if kind == "event_msg" {
                match event {
                    "task_started" | "turn_started" => {
                        self.turn = payload["turn_id"].as_str().map(str::to_owned);
                        phase = Some(Phase::Working);
                    }
                    "task_complete" | "turn_complete" | "turn_aborted" => {
                        if self
                            .turn
                            .as_deref()
                            .zip(payload["turn_id"].as_str())
                            .is_some_and(|(a, b)| a != b)
                        {
                            return;
                        }
                        phase = Some(Phase::Idle);
                    }
                    "user_message" => {
                        if self.phase != Some(Phase::Working) {
                            self.turn = payload["turn_id"].as_str().map(str::to_owned);
                        }
                        phase = Some(if self.phase == Some(Phase::Working) {
                            Phase::Working
                        } else {
                            Phase::Recent
                        });
                    }
                    "token_count" | "token_usage_record" | "agent_message" | "agent_reasoning"
                    | "item_completed" | "exec_command_end" | "mcp_tool_call_end"
                        if self.phase != Some(Phase::Idle) =>
                    {
                        phase = Some(self.phase.unwrap_or(Phase::Recent));
                    }
                    _ => {}
                }
            } else if kind == "response_item" {
                if payload["role"] == "assistant" && payload["phase"] == "final_answer" {
                    phase = Some(Phase::Idle);
                } else if payload["role"] == "user" {
                    if self.phase != Some(Phase::Working) {
                        self.turn = payload["turn_id"].as_str().map(str::to_owned);
                    }
                    phase = Some(if self.phase == Some(Phase::Working) {
                        Phase::Working
                    } else {
                        Phase::Recent
                    });
                } else if self.phase != Some(Phase::Idle)
                    && matches!(
                        event,
                        "message"
                            | "reasoning"
                            | "function_call"
                            | "function_call_output"
                            | "custom_tool_call"
                            | "custom_tool_call_output"
                            | "local_shell_call"
                    )
                {
                    phase = Some(self.phase.unwrap_or(Phase::Recent));
                }
            }
        } else if provider == "claude" {
            if kind == "system"
                && matches!(
                    value["subtype"].as_str(),
                    Some("turn_duration" | "stop_hook_summary")
                )
            {
                phase = Some(Phase::Idle);
            } else if kind == "assistant" {
                phase = Some(
                    if matches!(
                        value["message"]["stop_reason"].as_str(),
                        Some("end_turn" | "stop_sequence")
                    ) {
                        Phase::Idle
                    } else {
                        Phase::Recent
                    },
                );
            } else if (kind == "user" && !value["isMeta"].as_bool().unwrap_or(false))
                || (kind == "progress" && self.phase != Some(Phase::Idle))
            {
                phase = Some(Phase::Recent);
            }
        }
        if let Some(phase) = phase {
            self.phase = Some(phase);
            self.at = Some(at);
        }
    }
    fn activity(&self, now: DateTime<Utc>) -> Option<SessionActivity> {
        let (state, ttl) = match self.phase? {
            Phase::Working => ("working", WORKING_SECONDS),
            Phase::Recent => ("recent", RECENT_SECONDS),
            Phase::Idle => return None,
        };
        let at = self.at?;
        let expires = at + Duration::seconds(ttl);
        if expires <= now {
            return None;
        }
        Some(SessionActivity {
            state,
            observed_at: at.to_rfc3339(),
            expires_at: expires.to_rfc3339(),
        })
    }
}

#[cfg(test)]
fn parse_tail(
    bytes: &[u8],
    truncated: bool,
    provider: &str,
    now: DateTime<Utc>,
) -> Option<SessionActivity> {
    let mut tracker = Tracker::default();
    for (index, line) in bytes.split(|b| *b == b'\n').enumerate() {
        if truncated && index == 0 {
            continue;
        }
        if let Ok(value) = serde_json::from_slice::<Value>(line) {
            tracker.record(&value, provider, now);
        }
    }
    tracker.activity(now)
}

#[derive(Default)]
struct CachedFile {
    identity: (u64, u64),
    offset: u64,
    modified: Option<SystemTime>,
    tracker: Tracker,
    pending: Vec<u8>,
    skip_record: bool,
}
impl CachedFile {
    fn ingest(&mut self, bytes: &[u8], provider: &str, now: DateTime<Utc>) {
        for part in bytes.split_inclusive(|b| *b == b'\n') {
            let newline = part.last() == Some(&b'\n');
            if !self.skip_record {
                if self.pending.len() + part.len() > RECORD_BYTES {
                    self.pending = Vec::new();
                    self.skip_record = true;
                } else {
                    self.pending.extend_from_slice(part);
                }
            }
            if newline {
                if !self.skip_record {
                    if let Ok(value) = serde_json::from_slice::<Value>(&self.pending) {
                        self.tracker.record(&value, provider, now);
                    }
                }
                self.pending.clear();
                self.skip_record = false;
            }
        }
        // Providers can finish a complete record before appending its newline.
        if !self.skip_record {
            if let Ok(value) = serde_json::from_slice::<Value>(&self.pending) {
                self.tracker.record(&value, provider, now);
                self.pending.clear();
            }
        }
    }
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}
#[cfg(not(unix))]
fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| (d.as_secs(), d.subsec_nanos() as u64))
        .unwrap_or_default()
}

#[derive(Default)]
pub struct ActivityReader {
    files: HashMap<PathBuf, (CachedFile, Instant)>,
    revision: u64,
}
impl ActivityReader {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn read_activity(
        &mut self,
        path: &Path,
        provider: &str,
        now: DateTime<Utc>,
    ) -> Option<SessionActivity> {
        if path.extension()?.to_str()? != "jsonl"
            || path.components().any(|part| {
                matches!(
                    part.as_os_str().to_str(),
                    Some("archived_sessions" | "subagents")
                )
            })
        {
            return None;
        }
        let mut file = File::open(path).ok()?;
        let metadata = file.metadata().ok()?;
        if !metadata.is_file()
            || metadata
                .modified()
                .ok()?
                .elapsed()
                .ok()
                .is_some_and(|age| age.as_secs() > WORKING_SECONDS as u64)
        {
            return None;
        }
        self.files
            .retain(|_, (_, touched)| touched.elapsed().as_secs() < 600);
        if !self.files.contains_key(path) && self.files.len() >= 64 {
            if let Some(oldest) = self
                .files
                .iter()
                .min_by_key(|(_, (_, touched))| *touched)
                .map(|(path, _)| path.clone())
            {
                self.files.remove(&oldest);
            }
        }
        let identity = file_identity(&metadata);
        let modified = metadata.modified().ok();
        let (cached, touched) = self
            .files
            .entry(path.to_path_buf())
            .or_insert_with(|| (CachedFile::default(), Instant::now()));
        *touched = Instant::now();
        let reset = cached.identity != identity
            || metadata.len() < cached.offset
            || (metadata.len() == cached.offset && cached.modified != modified)
            || metadata.len().saturating_sub(cached.offset) > TAIL_BYTES;
        if reset {
            let start = metadata.len().saturating_sub(TAIL_BYTES);
            *cached = CachedFile {
                identity,
                offset: start,
                modified,
                skip_record: start > 0,
                ..Default::default()
            };
        }
        if metadata.len() > cached.offset {
            file.seek(SeekFrom::Start(cached.offset)).ok()?;
            let mut bytes = Vec::new();
            file.take(metadata.len().saturating_sub(cached.offset).min(TAIL_BYTES))
                .read_to_end(&mut bytes)
                .ok()?;
            cached.ingest(&bytes, provider, now);
            cached.offset += bytes.len() as u64;
            if !bytes.is_empty() {
                self.revision = self.revision.wrapping_add(1);
            }
        }
        cached.modified = modified;
        cached.tracker.activity(now)
    }

    pub fn read_sessions(
        &mut self,
        sessions: &[Session],
        keys: &[String],
        sources: &[super::types::Source],
    ) -> Result<HashMap<String, SessionActivity>> {
        let keys: HashSet<_> = keys.iter().collect();
        let roots: HashMap<_, _> = sources
            .iter()
            .filter_map(|s| {
                std::fs::canonicalize(&s.root)
                    .ok()
                    .map(|root| (&s.id, root))
            })
            .collect();
        let now: DateTime<Utc> = SystemTime::now().into();
        let mut activities = HashMap::new();
        for session in sessions.iter().filter(|s| keys.contains(&s.key)) {
            let Some(root) = roots.get(&session.source_id) else {
                continue;
            };
            let Some(path) = session
                .source_path
                .as_deref()
                .and_then(|p| std::fs::canonicalize(p).ok())
                .filter(|p| p.starts_with(root))
            else {
                continue;
            };
            if let Some(activity) = self.read_activity(&path, &session.provider, now) {
                activities.insert(session.key.clone(), activity);
            }
        }
        Ok(activities)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn read_sessions(
        sessions: &[Session],
        keys: &[String],
        sources: &[super::super::types::Source],
    ) -> Result<HashMap<String, SessionActivity>> {
        ActivityReader::default().read_sessions(sessions, keys, sources)
    }
    fn read_activity(path: &Path, provider: &str, now: DateTime<Utc>) -> Option<SessionActivity> {
        ActivityReader::default().read_activity(path, provider, now)
    }
    #[test]
    fn finds_start_before_old_tail_and_keeps_working_across_many_large_polls() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.jsonl");
        let mut writer = File::create(&path).unwrap();
        writeln!(writer, "{}", event("task_started", 10, "long-turn")).unwrap();
        let large = json!({"type":"response_item","timestamp":now().to_rfc3339(),"payload":{"type":"function_call_output","output":"x".repeat(600_000)}}).to_string();
        writeln!(writer, "{large}").unwrap();
        let mut reader = ActivityReader::default();
        assert_eq!(
            reader.read_activity(&path, "codex", now()).unwrap().state,
            "working"
        );
        let revision = reader.revision();
        reader.read_activity(&path, "codex", now());
        assert_eq!(
            reader.revision(),
            revision,
            "unchanged logs do not dirty costs"
        );
        for _ in 0..16 {
            writeln!(writer, "{large}").unwrap();
            assert_eq!(
                reader.read_activity(&path, "codex", now()).unwrap().state,
                "working"
            );
        }
        assert_eq!(
            reader.revision(),
            revision + 16,
            "each append invalidates cost data"
        );
        writeln!(writer, "{}", event("task_complete", 0, "long-turn")).unwrap();
        assert!(reader.read_activity(&path, "codex", now()).is_none());
    }
    #[test]
    fn incomplete_appends_and_truncated_files_do_not_leave_cached_working() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tail.jsonl");
        std::fs::write(&path, format!("{}\n", event("task_started", 1, "a"))).unwrap();
        let mut reader = ActivityReader::default();
        assert_eq!(
            reader.read_activity(&path, "codex", now()).unwrap().state,
            "working"
        );
        let done = event("task_complete", 0, "a").to_string();
        let split = done.len() / 2;
        let mut writer = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        write!(writer, "{}", &done[..split]).unwrap();
        assert_eq!(
            reader.read_activity(&path, "codex", now()).unwrap().state,
            "working"
        );
        writeln!(writer, "{}", &done[split..]).unwrap();
        assert!(reader.read_activity(&path, "codex", now()).is_none());
        drop(writer);
        std::fs::write(&path, format!("{}\n", event("task_started", 0, "b"))).unwrap();
        assert_eq!(
            reader.read_activity(&path, "codex", now()).unwrap().state,
            "working"
        );
        std::fs::write(&path, "{}\n").unwrap();
        assert!(reader.read_activity(&path, "codex", now()).is_none());
    }
    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-06T20:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }
    fn event(kind: &str, seconds_ago: i64, turn: &str) -> Value {
        json!({"type":"event_msg","timestamp":(now()-Duration::seconds(seconds_ago)).to_rfc3339(),"payload":{"type":kind,"turn_id":turn}})
    }
    fn activity(events: &[Value], provider: &str, at: DateTime<Utc>) -> Option<SessionActivity> {
        let text = events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        parse_tail(text.as_bytes(), false, provider, at)
    }

    #[test]
    fn polls_only_known_sessions_inside_configured_roots_and_reads_completions() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("session.jsonl");
        let current = Utc::now();
        std::fs::write(&path, json!({"type":"event_msg","timestamp":current.to_rfc3339(),"payload":{"type":"task_started","turn_id":"a"}}).to_string()).unwrap();
        let mut session = Session {
            key: "session".into(),
            provider: "codex".into(),
            source_id: "source".into(),
            source_path: Some(path.to_string_lossy().into()),
            ..Default::default()
        };
        let source = super::super::types::Source {
            id: "source".into(),
            provider: "codex".into(),
            root: root.path().to_string_lossy().into(),
            status: "ready".into(),
            session_count: 1,
            warning: None,
        };
        let requested = vec!["session".into()];
        assert_eq!(
            read_sessions(
                &[session.clone()],
                &requested,
                std::slice::from_ref(&source)
            )
            .unwrap()["session"]
                .state,
            "working"
        );
        assert!(read_sessions(
            &[session.clone()],
            &["unrelated".into()],
            std::slice::from_ref(&source)
        )
        .unwrap()
        .is_empty());
        std::fs::write(&path, json!({"type":"event_msg","timestamp":current.to_rfc3339(),"payload":{"type":"task_complete","turn_id":"a"}}).to_string()).unwrap();
        assert!(read_sessions(
            &[session.clone()],
            &requested,
            std::slice::from_ref(&source)
        )
        .unwrap()
        .is_empty());
        let outside = tempfile::Builder::new()
            .suffix(".jsonl")
            .tempfile()
            .unwrap();
        std::fs::write(outside.path(),json!({"type":"event_msg","timestamp":current.to_rfc3339(),"payload":{"type":"task_started"}}).to_string()).unwrap();
        session.source_path = Some(outside.path().to_string_lossy().into());
        assert!(read_sessions(&[session], &requested, &[source])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_later_fallback_turn_can_complete_without_inheriting_the_old_turn_id() {
        assert!(activity(
            &[
                event("task_started", 30, "a"),
                event("task_complete", 20, "a"),
                event("user_message", 10, "b"),
                event("task_complete", 1, "b")
            ],
            "codex",
            now()
        )
        .is_none());
    }

    #[test]
    fn codex_start_heartbeat_completion_and_abort() {
        assert_eq!(
            activity(
                &[event("task_started", 30, "a"), event("token_count", 1, "a")],
                "codex",
                now()
            )
            .unwrap()
            .state,
            "working"
        );
        for terminal in ["task_complete", "turn_complete", "turn_aborted"] {
            assert!(activity(
                &[
                    event("task_started", 30, "a"),
                    event(terminal, 2, "a"),
                    event("token_count", 1, "a")
                ],
                "codex",
                now()
            )
            .is_none());
        }
    }
    #[test]
    fn custom_tool_events_keep_long_turns_alive_but_do_not_reopen_completed_turns() {
        for kind in ["custom_tool_call", "custom_tool_call_output"] {
            let heartbeat = json!({"type":"response_item","timestamp":now().to_rfc3339(),"payload":{"type":kind}});
            assert_eq!(
                activity(
                    &[event("task_started", 180, "a"), heartbeat.clone()],
                    "codex",
                    now()
                )
                .unwrap()
                .state,
                "working"
            );
            assert!(activity(
                &[
                    event("task_started", 180, "a"),
                    event("task_complete", 1, "a"),
                    heartbeat
                ],
                "codex",
                now()
            )
            .is_none());
        }
        assert_eq!(
            activity(
                &[
                    event("task_started", 180, "a"),
                    event("token_usage_record", 0, "a")
                ],
                "codex",
                now()
            )
            .unwrap()
            .state,
            "working"
        );
    }
    #[test]
    fn ignores_old_turn_completion_and_expires_quiet_or_crashed_turns() {
        let events = [
            event("turn_started", 10, "new"),
            event("task_complete", 5, "old"),
        ];
        assert_eq!(activity(&events, "codex", now()).unwrap().state, "working");
        assert!(activity(&events, "codex", now() + Duration::seconds(120)).is_none());
        assert!(activity(&[event("task_started", -60, "future")], "codex", now()).is_none());
    }
    #[test]
    fn fresh_prompt_without_lifecycle_is_only_recent_and_reopens_after_completion() {
        let events = [
            event("task_complete", 20, "a"),
            event("user_message", 1, "b"),
        ];
        assert_eq!(activity(&events, "codex", now()).unwrap().state, "recent");
        assert!(activity(&events, "codex", now() + Duration::seconds(45)).is_none());
    }
    #[test]
    fn claude_recent_activity_stops_on_explicit_completion() {
        let prompt =
            json!({"type":"user","timestamp":now().to_rfc3339(),"message":{"role":"user"}});
        assert_eq!(
            activity(std::slice::from_ref(&prompt), "claude", now())
                .unwrap()
                .state,
            "recent"
        );
        let done = json!({"type":"assistant","timestamp":now().to_rfc3339(),"message":{"stop_reason":"end_turn"}});
        assert!(activity(&[prompt.clone(), done], "claude", now()).is_none());
        let done =
            json!({"type":"system","subtype":"turn_duration","timestamp":now().to_rfc3339()});
        assert!(activity(&[prompt, done], "claude", now()).is_none());
    }
    #[test]
    fn metadata_sidechains_and_file_touches_are_not_activity() {
        for value in [
            json!({"type":"session_meta","timestamp":now().to_rfc3339()}),
            json!({"type":"user","isMeta":true,"timestamp":now().to_rfc3339()}),
            json!({"type":"user","isSidechain":true,"timestamp":now().to_rfc3339()}),
        ] {
            assert!(activity(&[value], "claude", now()).is_none());
        }
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(read_activity(file.path(), "codex", now()).is_none());
    }
    #[test]
    fn incomplete_tail_does_not_crash_or_treat_truncated_start_as_working() {
        let text = format!(
            "partial broken record\n{}\n{{\"type\":",
            event("token_count", 1, "a")
        );
        assert_eq!(
            parse_tail(text.as_bytes(), true, "codex", now())
                .unwrap()
                .state,
            "recent"
        );
    }
}
