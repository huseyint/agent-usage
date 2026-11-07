use super::types::*;
use chrono::{DateTime, Local, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub fn stable_id(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))[..20].into()
}
pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}
pub fn bounded_title(text: &str) -> Option<String> {
    let title: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect();
    (!title.is_empty()).then_some(title)
}
pub fn clean_title(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty()
        || text.starts_with(['<', '/', '!', '#', '{', '['])
        || text.contains("<environment_context>")
        || text.contains("AGENTS.md instructions")
        || text.contains("<INSTRUCTIONS>")
        || text.starts_with("You are ")
    {
        return None;
    }
    let title: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect();
    (title.chars().count() >= 3).then_some(title)
}
pub fn fallback_title(project: &str, id: &str) -> String {
    let short = id.rsplit('/').next().unwrap_or(id);
    let short: String = short.chars().take(12).collect();
    if project.is_empty() || project == "Unknown project" {
        short
    } else {
        format!("{project} • {short}")
    }
}
pub fn local_day(timestamp: &str, tz: &str) -> Option<String> {
    let t = DateTime::parse_from_rfc3339(timestamp).ok()?;
    Some(if tz == "local" {
        t.with_timezone(&Local).format("%Y-%m-%d").to_string()
    } else {
        t.with_timezone(&tz.parse::<chrono_tz::Tz>().ok()?)
            .format("%Y-%m-%d")
            .to_string()
    })
}
pub fn normalize_roots(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut paths: Vec<_> = paths
        .into_iter()
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .collect();
    paths.sort_by_key(|p| p.components().count());
    let mut out: Vec<PathBuf> = vec![];
    for p in paths {
        if !out.iter().any(|r| p.starts_with(r)) {
            out.push(p);
        }
    }
    out
}
pub fn roots(p: &Preferences) -> Vec<Source> {
    let h = home();
    let mut out = vec![];
    for (provider, custom, env_key, defaults) in [
        (
            "claude",
            &p.claude_roots,
            "CLAUDE_CONFIG_DIR",
            vec![h.join(".claude"), h.join(".config/claude")],
        ),
        (
            "codex",
            &p.codex_roots,
            "CODEX_HOME",
            vec![h.join(".codex")],
        ),
    ] {
        let configured = if !custom.is_empty() {
            custom.iter().map(PathBuf::from).collect()
        } else if let Ok(v) = std::env::var(env_key) {
            v.split(',').map(|s| PathBuf::from(s.trim())).collect()
        } else {
            defaults
        };
        for root in normalize_roots(configured) {
            let usage = if provider == "claude" {
                root.join("projects")
            } else {
                root.join("sessions")
            };
            let status = if !root.exists() {
                "missing"
            } else if std::fs::read_dir(&root).is_err() {
                "unreadable"
            } else if !usage.is_dir()
                && !(provider == "codex" && root.join("archived_sessions").is_dir())
            {
                "empty"
            } else {
                "ready"
            };
            let root = root.to_string_lossy().into_owned();
            out.push(Source {
                id: stable_id(&format!("{provider}:{root}")),
                provider: provider.into(),
                root,
                status: status.into(),
                session_count: 0,
                warning: None,
            });
        }
    }
    out
}
#[derive(Default, Clone)]
struct Meta {
    id: String,
    source: String,
    path: String,
    project: String,
    first: String,
    days: BTreeSet<String>,
    native: Option<(u8, String)>,
    prompt: Option<String>,
    metadata_incomplete: bool,
}
fn content(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        return clean_title(s);
    }
    v.as_array()?
        .iter()
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .find_map(clean_title)
}
fn set_native(meta: &mut Meta, priority: u8, text: &str) {
    if let Some(t) = bounded_title(text) {
        if meta.native.as_ref().is_none_or(|(p, _)| priority >= *p) {
            meta.native = Some((priority, t));
        }
    }
}
const RECORD_BYTES: usize = 1024 * 1024;
const FILE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Default)]
struct LineScan {
    oversized_records: usize,
    malformed_records: usize,
    file_limit_reached: bool,
    io_failed: bool,
}
impl LineScan {
    fn metadata_incomplete(&self) -> bool {
        self.oversized_records > 0
            || self.malformed_records > 0
            || self.file_limit_reached
            || self.io_failed
    }
}
fn parse_record(bytes: &[u8], scan: &mut LineScan, f: &mut impl FnMut(Value)) {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return;
    }
    match serde_json::from_slice(bytes) {
        Ok(v) => f(v),
        // A corrupt record or an append-in-progress tail does not invalidate other metadata.
        Err(_) => scan.malformed_records += 1,
    }
}
fn scan_lines(
    mut reader: impl BufRead,
    record_limit: usize,
    file_limit: usize,
    mut f: impl FnMut(Value),
) -> LineScan {
    let mut scan = LineScan::default();
    let mut record = Vec::new();
    let mut oversized = false;
    let mut consumed = 0;
    loop {
        let available = match reader.fill_buf() {
            Ok([]) => break,
            Ok(bytes) => bytes,
            Err(_) => {
                scan.io_failed = true;
                return scan;
            }
        };
        if consumed == file_limit {
            scan.file_limit_reached = true;
            return scan;
        }
        let end = available.iter().position(|b| *b == b'\n');
        let len = end
            .map_or(available.len(), |i| i + 1)
            .min(file_limit - consumed);
        let newline = available[len - 1] == b'\n';
        if !oversized {
            if record.len() + len > record_limit {
                oversized = true;
                scan.oversized_records += 1;
                record.clear();
            } else {
                record.extend_from_slice(&available[..len]);
            }
        }
        reader.consume(len);
        consumed += len;
        if newline {
            if !oversized {
                parse_record(&record, &mut scan, &mut f);
            }
            record.clear();
            oversized = false;
        }
    }
    if !oversized && !record.is_empty() {
        parse_record(&record, &mut scan, &mut f);
    }
    scan
}
fn lines(path: &Path, f: impl FnMut(Value)) -> LineScan {
    let Ok(file) = File::open(path) else {
        return LineScan {
            io_failed: true,
            ..Default::default()
        };
    };
    let reader: Box<dyn Read> = if path.extension().is_some_and(|x| x == "zst") {
        match zstd::stream::read::Decoder::new(file) {
            Ok(d) => Box::new(d),
            Err(_) => {
                return LineScan {
                    io_failed: true,
                    ..Default::default()
                }
            }
        }
    } else {
        Box::new(file)
    };
    scan_lines(BufReader::new(reader), RECORD_BYTES, FILE_BYTES, f)
}

pub struct Enrichment {
    pub warnings: Vec<String>,
    // Access failures can mean missing usage. Metadata parsing limits cannot.
    pub source_access_failed: bool,
}
fn uuid_from_id(id: &str) -> String {
    let s = id.rsplit('/').next().unwrap_or(id);
    if s.len() >= 36 && s.is_char_boundary(s.len() - 36) {
        let tail = &s[s.len() - 36..];
        if tail.chars().filter(|c| *c == '-').count() == 4 {
            return tail.into();
        }
    }
    s.into()
}
pub fn enrich(sessions: &mut [Session], sources: &mut [Source], p: &Preferences) -> Enrichment {
    let mut map: HashMap<(String, String, String), Meta> = HashMap::new();
    let mut warnings = vec![];
    let mut source_access_failed = false;
    for source in sources.iter_mut().filter(|s| s.status == "ready") {
        let root = PathBuf::from(&source.root);
        let mut oversized_records = 0;
        let mut malformed_records = 0;
        let mut limited_files = 0;
        let mut access_failures = 0;
        let mut indexed: HashMap<String, String> = HashMap::new();
        if source.provider == "codex" {
            let mut versions: HashMap<String, (String, String)> = HashMap::new();
            lines(&root.join("session_index.jsonl"), |v| {
                if let (Some(id), Some(title)) = (v["id"].as_str(), v["thread_name"].as_str()) {
                    if let Some(title) = bounded_title(title) {
                        let at = v["updated_at"].as_str().unwrap_or("").to_string();
                        if versions.get(id).is_none_or(|(prev, _)| at >= *prev) {
                            versions.insert(id.into(), (at, title));
                        }
                    }
                }
            });
            indexed.extend(versions.into_iter().map(|(k, (_, v))| (k, v)));
            // Optional schema-probed read-only title index. Never lock or migrate the provider DB.
            if let Ok(entries) = std::fs::read_dir(&root) {
                for e in entries.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with("state_") && name.ends_with(".sqlite") {
                        if let Ok(db) = Connection::open_with_flags(
                            e.path(),
                            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                        ) {
                            let _ = db.busy_timeout(std::time::Duration::from_millis(100));
                            if let Ok(mut stmt) =
                                db.prepare("SELECT id,title FROM threads WHERE title IS NOT NULL")
                            {
                                if let Ok(rows) = stmt.query_map([], |r| {
                                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                                }) {
                                    for (id, t) in rows.flatten() {
                                        if let Some(t) = bounded_title(&t) {
                                            indexed.entry(id).or_insert(t);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        let dirs = if source.provider == "claude" {
            vec![root.join("projects")]
        } else {
            vec![root.join("sessions"), root.join("archived_sessions")]
        };
        let mut files = vec![];
        for dir in dirs {
            if !dir.exists() {
                continue;
            }
            for entry in WalkDir::new(&dir)
                .follow_links(false)
                .max_depth(14)
                .into_iter()
                .filter_entry(|e| e.file_name() != "subagents")
            {
                match entry {
                    Ok(e) if e.file_type().is_file() => {
                        let name = e.file_name().to_string_lossy();
                        if name.ends_with(".jsonl") || name.ends_with(".jsonl.zst") {
                            files.push(e.into_path());
                        }
                    }
                    Err(_) => {
                        access_failures += 1;
                    }
                    _ => {}
                }
            }
        }
        files.sort();
        for path in files {
            let mut meta = Meta {
                source: source.id.clone(),
                path: path.to_string_lossy().into_owned(),
                ..Meta::default()
            };
            let mut sidechain = false;
            let scan = lines(&path, |v| {
                if v["isSidechain"].as_bool() == Some(true) {
                    sidechain = true;
                }
                if let Some(id) = v["sessionId"].as_str() {
                    if meta.id.is_empty() {
                        meta.id = id.into();
                    }
                }
                if v["type"] == "session_meta" {
                    if let Some(id) = v.pointer("/payload/id").and_then(Value::as_str) {
                        meta.id = id.into();
                    }
                    if let Some(cwd) = v.pointer("/payload/cwd").and_then(Value::as_str) {
                        meta.project = cwd.into();
                    }
                }
                if let Some(cwd) = v["cwd"].as_str() {
                    meta.project = cwd.into();
                }
                let usage = v.pointer("/message/usage").is_some()
                    || v.pointer("/payload/type").and_then(Value::as_str) == Some("token_count");
                if usage {
                    if let Some(t) = v["timestamp"].as_str() {
                        if DateTime::parse_from_rfc3339(t).is_ok() {
                            if meta.first.is_empty() || t < meta.first.as_str() {
                                meta.first = t.into();
                            }
                            if let Some(d) = local_day(t, &p.timezone) {
                                meta.days.insert(d);
                            }
                        }
                    }
                }
                for (field, priority) in [
                    ("customTitle", 3),
                    ("custom-title", 3),
                    ("aiTitle", 2),
                    ("ai-title", 2),
                    ("summary", 1),
                ] {
                    if let Some(t) = v[field].as_str() {
                        set_native(&mut meta, priority, t);
                    }
                }
                if ["custom-title", "ai-title"].contains(&v["type"].as_str().unwrap_or("")) {
                    if let Some(t) = v["customTitle"].as_str().or_else(|| v["title"].as_str()) {
                        set_native(
                            &mut meta,
                            if v["type"] == "custom-title" { 3 } else { 2 },
                            t,
                        );
                    }
                }
                if p.prompt_fallback && meta.prompt.is_none() {
                    if v["type"] == "user" && !v["isMeta"].as_bool().unwrap_or(false) {
                        meta.prompt = v.pointer("/message/content").and_then(content);
                    }
                    if v.pointer("/payload/role").and_then(Value::as_str) == Some("user") {
                        meta.prompt = v.pointer("/payload/content").and_then(content);
                    }
                    if v.pointer("/payload/type").and_then(Value::as_str) == Some("user_message") {
                        meta.prompt = v.pointer("/payload/message").and_then(content);
                    }
                }
            });
            oversized_records += scan.oversized_records;
            malformed_records += scan.malformed_records;
            limited_files += usize::from(scan.file_limit_reached);
            access_failures += usize::from(scan.io_failed);
            meta.metadata_incomplete = scan.metadata_incomplete();
            if meta.metadata_incomplete {
                // Do not present a partial set of event days or a later prompt as complete metadata.
                meta.first.clear();
                meta.days.clear();
                meta.prompt = None;
            }
            if sidechain || path.components().any(|c| c.as_os_str() == "subagents") {
                continue;
            }
            if meta.id.is_empty() {
                meta.id = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .trim_end_matches(".zst")
                    .trim_end_matches(".jsonl")
                    .into();
            }
            if let Some(t) = indexed.get(&meta.id) {
                set_native(&mut meta, 3, t);
            }
            map.entry((source.id.clone(), source.provider.clone(), meta.id.clone()))
                .and_modify(|prev| {
                    prev.metadata_incomplete |= meta.metadata_incomplete;
                    prev.days.extend(meta.days.clone());
                    if prev.first.is_empty() || (!meta.first.is_empty() && meta.first < prev.first)
                    {
                        prev.first = meta.first.clone();
                    }
                    if meta.native.is_some() {
                        prev.native = meta.native.clone();
                    }
                })
                .or_insert(meta);
        }
        // Read index metadata only; ignore prompt contents in index when fallback is off.
        if source.provider == "claude" {
            let projects = root.join("projects");
            if let Ok(entries) = std::fs::read_dir(projects) {
                for entry in entries.flatten() {
                    let idx = entry.path().join("sessions-index.json");
                    if let Ok(file) = File::open(idx) {
                        if let Ok(v) =
                            serde_json::from_reader::<_, Value>(file.take(4 * 1024 * 1024))
                        {
                            if let Some(rows) = v["entries"].as_array() {
                                for row in rows {
                                    if let Some(id) = row["sessionId"].as_str() {
                                        if let Some(m) = map.get_mut(&(
                                            source.id.clone(),
                                            "claude".into(),
                                            id.into(),
                                        )) {
                                            if m.project.is_empty() {
                                                m.project = row["projectPath"]
                                                    .as_str()
                                                    .unwrap_or_default()
                                                    .into();
                                            }
                                            if let Some(t) = row["summary"].as_str() {
                                                set_native(m, 1, t);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        source_access_failed |= access_failures > 0;
        if oversized_records + malformed_records + limited_files + access_failures > 0 {
            source.warning = Some(format!("Session metadata incomplete: {oversized_records} oversized records, {malformed_records} malformed records, {limited_files} files at the scan limit, {access_failures} access errors. Usage totals are imported separately from ccusage."));
        }
    }
    for row in sessions {
        let native = uuid_from_id(&row.id);
        let found = map
            .get(&(row.source_id.clone(), row.provider.clone(), native.clone()))
            .or_else(|| map.get(&(row.source_id.clone(), row.provider.clone(), row.id.clone())))
            .or_else(|| {
                map.values().find(|m| {
                    m.source == row.source_id
                        && m.path.ends_with(&format!(
                            "{}.jsonl",
                            row.id.rsplit('/').next().unwrap_or(&row.id)
                        ))
                })
            });
        if let Some(m) = found {
            row.id = m.id.clone();
            row.source_id = m.source.clone();
            row.source_path = Some(m.path.clone());
            if !m.project.is_empty() {
                row.project_path = m.project.clone();
            }
            row.first_activity = m.first.clone();
            row.activity_days = if m.metadata_incomplete {
                vec![]
            } else {
                m.days.iter().cloned().collect()
            };
            if m.metadata_incomplete {
                row.first_activity.clear();
                row.source_status = "metadata incomplete".into();
            }
            row.native_title = m.native.as_ref().map(|(_, t)| t.clone());
            row.title = m
                .native
                .as_ref()
                .map(|(_, t)| t.clone())
                .or_else(|| m.prompt.clone())
                .unwrap_or_default();
            row.title_provenance = if m.native.is_some() {
                "native"
            } else if m.prompt.is_some() {
                "prompt"
            } else {
                "identifier"
            }
            .into();
        }
        if row.source_id.is_empty() {
            row.source_id = sources
                .iter()
                .find(|s| s.provider == row.provider && s.status == "ready")
                .map(|s| s.id.clone())
                .unwrap_or_else(|| "unknown".into());
        }
        if row.project_path.starts_with('/') || Path::new(&row.project_path).is_absolute() {
            row.project_path = std::fs::canonicalize(&row.project_path)
                .unwrap_or_else(|_| PathBuf::from(&row.project_path))
                .to_string_lossy()
                .into();
        }
        row.project = Path::new(&row.project_path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Unknown project".into());
        if row.title.is_empty() {
            row.title = fallback_title(&row.project, &row.id);
            row.title_provenance = "identifier".into();
        }
        row.key = format!("{}:{}:{}", row.provider, row.source_id, row.id);
        if row.source_status.is_empty() {
            row.source_status = "verified".into();
        }
        if let Some(source) = sources.iter_mut().find(|s| s.id == row.source_id) {
            source.session_count += 1;
        }
    }
    if sources.iter().any(|s| s.warning.is_some()) {
        warnings.push("Session metadata is incomplete for some logs. Usage totals come from ccusage; affected session date filters use last activity, and some titles may use identifier fallbacks.".into());
    }
    Enrichment {
        warnings,
        source_access_failed,
    }
}
pub fn now() -> String {
    Utc::now().to_rfc3339()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_record_is_skipped_without_losing_later_metadata() {
        let input = format!(
            "{{\"id\":1}}\n{{\"large\":\"{}\"}}\n{{\"id\":2}}\n",
            "x".repeat(RECORD_BYTES + 20)
        );
        let mut ids = vec![];
        let scan = scan_lines(
            BufReader::with_capacity(7, input.as_bytes()),
            RECORD_BYTES,
            FILE_BYTES,
            |v| ids.push(v["id"].as_u64().unwrap()),
        );
        assert_eq!(ids, vec![1, 2]);
        assert_eq!(scan.oversized_records, 1);
        assert!(!scan.io_failed);
    }
    #[test]
    fn malformed_record_and_partial_tail_are_nonfatal() {
        let input = b"{bad record}\n{\"id\":1}\n{\"partial\":";
        let mut count = 0;
        let scan = scan_lines(BufReader::new(&input[..]), 100, 1000, |_| count += 1);
        assert_eq!(count, 1);
        assert_eq!(scan.malformed_records, 2);
        assert!(!scan.io_failed);
    }
    #[test]
    fn record_boundary_and_final_record_without_newline_are_valid() {
        let input = b"{\"id\":1}\n{\"id\":2}";
        let mut count = 0;
        let scan = scan_lines(
            BufReader::with_capacity(3, &input[..]),
            9,
            input.len(),
            |_| count += 1,
        );
        assert_eq!(count, 2);
        assert!(!scan.metadata_incomplete());
    }
    #[test]
    fn file_scan_limit_is_separate_from_io_failure() {
        let input = b"{\"id\":1}\n{\"id\":2}\n";
        let scan = scan_lines(BufReader::new(&input[..]), 100, 10, |_| {});
        assert!(scan.file_limit_reached);
        assert!(!scan.io_failed);
        let temp = tempfile::tempdir().unwrap();
        assert!(lines(&temp.path().join("missing.jsonl"), |_| {}).io_failed);
    }
    #[test]
    fn sanitizes_prompt_wrappers_and_unicode() {
        assert!(clean_title("<environment_context>secret").is_none());
        assert!(clean_title("# AGENTS.md instructions").is_none());
        assert_eq!(
            clean_title(" Fix\n login  redirect ").unwrap(),
            "Fix login redirect"
        );
        assert_eq!(clean_title(&"🦀".repeat(200)).unwrap().chars().count(), 160);
    }
    #[test]
    fn title_precedence() {
        let mut m = Meta::default();
        set_native(&mut m, 3, "Custom title");
        set_native(&mut m, 1, "Summary later");
        assert_eq!(m.native.unwrap().1, "Custom title");
    }
    #[test]
    fn overlapping_roots() {
        let r = normalize_roots(vec![
            "/fake/a".into(),
            "/fake/a/b".into(),
            "/fake/a".into(),
            "/fake/c".into(),
        ]);
        assert_eq!(r.len(), 2);
    }
    #[test]
    fn dst_boundaries() {
        assert_eq!(
            local_day("2026-11-01T06:30:00Z", "America/Chicago"),
            Some("2026-11-01".into())
        );
        assert_eq!(
            local_day("2026-11-01T07:30:00Z", "America/Chicago"),
            Some("2026-11-01".into())
        );
        assert_eq!(
            local_day("2026-03-08T05:59:00Z", "America/Chicago"),
            Some("2026-03-07".into())
        );
    }
}
