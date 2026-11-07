pub mod activity;
pub mod engine;
pub mod metadata;
pub mod project_icons;
pub mod reports;
pub mod storage;
pub mod types;
pub mod usage;
#[cfg(windows)]
mod windows_job;
#[cfg(test)]
mod integration_tests {
    use super::{engine, metadata, reports, types::*, usage};
    use std::path::{Path, PathBuf};
    fn copy_dir(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for e in std::fs::read_dir(from).unwrap() {
            let e = e.unwrap();
            let out = to.join(e.file_name());
            if e.file_type().unwrap().is_dir() {
                copy_dir(&e.path(), &out);
            } else {
                std::fs::copy(e.path(), out).unwrap();
            }
        }
    }
    fn fixture_engine() -> PathBuf {
        let target = engine::TARGET;
        let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
            "binaries/ccusage-{target}{}",
            if cfg!(windows) { ".exe" } else { "" }
        ));
        assert!(
            executable.is_file(),
            "Build the host sidecar with pnpm engine:build before running tests"
        );
        executable
    }
    #[test]
    fn real_sidecar_roundtrip_and_title_layers() {
        let executable = fixture_engine();
        let dir = tempfile::tempdir().unwrap();
        copy_dir(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/sources"),
            &dir.path().join("logs"),
        );
        let p = Preferences {
            timezone: "America/Chicago".into(),
            claude_roots: vec![dir.path().join("logs/claude").to_string_lossy().into()],
            codex_roots: vec![dir.path().join("logs/codex").to_string_lossy().into()],
            ..Default::default()
        };
        let mut sources = metadata::roots(&p);
        assert_eq!(
            engine::probe(&executable, dir.path()).unwrap(),
            engine::VERSION
        );
        let args = [
            "daily",
            "--sections",
            "daily,session",
            "--by-agent",
            "--json",
            "--breakdown",
            "--offline",
            "--mode",
            "auto",
            "--timezone",
            "America/Chicago",
        ]
        .map(str::to_string);
        for source in &sources {
            let bytes =
                engine::run(&executable, &args, dir.path(), std::slice::from_ref(source)).unwrap();
            let (isolated, _) = usage::parse(&bytes).unwrap();
            assert_eq!(isolated.len(), 1);
            assert_eq!(isolated[0].provider, source.provider);
        }
        let bytes = engine::run(&executable, &args, dir.path(), &sources).unwrap();
        let (mut sessions, daily) = usage::parse(&bytes).unwrap();
        for s in &mut sessions {
            s.source_id = sources
                .iter()
                .find(|r| r.provider == s.provider)
                .unwrap()
                .id
                .clone();
        }
        metadata::enrich(&mut sessions, &mut sources, &p);
        let codex = sessions.iter().find(|s| s.provider == "codex").unwrap();
        assert_eq!(codex.title, "Refine the command palette");
        assert_eq!(codex.project, "workbench");
        assert_eq!(codex.tokens.total, 150);
        assert!(codex.source_path.is_some());
        let claude = sessions.iter().find(|s| s.provider == "claude").unwrap();
        assert_eq!(claude.title, "Keyboard navigation improvements");
        assert_eq!(claude.activity_days.len(), 2);
        assert_eq!(claude.daily_usage.as_ref().unwrap().len(), 2);
        let snapshot = Snapshot {
            timezone: p.timezone,
            ..Snapshot {
                sessions,
                daily,
                sources,
                ..Default::default()
            }
        };
        let query = Query {
            since: Some("2026-11-01".into()),
            until: Some("2026-11-01".into()),
            ..Default::default()
        };
        let v = reports::build(
            snapshot,
            &query,
            &Default::default(),
            &Default::default(),
            false,
        )
        .unwrap();
        assert_eq!(v.session_count, 2);
        assert_eq!(v.summary.tokens.total, 1700);
        assert_eq!(v.summary.lifetime_cost_micros, 2_500_614);
        assert_eq!(
            v.sessions
                .iter()
                .map(|s| s.period_cost_micros.unwrap())
                .sum::<i64>(),
            v.summary.cost_micros
        );
        assert_eq!(
            v.sessions
                .iter()
                .find(|s| s.provider == "claude")
                .unwrap()
                .period_cost_micros,
            Some(1_250_000)
        );
        assert!(v.sessions.iter().map(|s| s.cost_micros).sum::<i64>() > v.summary.cost_micros);
    }
    #[test]
    fn oversized_metadata_does_not_reject_authoritative_usage_snapshot() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("logs");
        copy_dir(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/sources"),
            &root,
        );
        let codex = root.join("codex");
        let path = walkdir::WalkDir::new(codex.join("sessions"))
            .into_iter()
            .flatten()
            .find(|e| e.file_type().is_file())
            .unwrap()
            .into_path();
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        writeln!(file,"{}",serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","output":"x".repeat(2*1024*1024)}})).unwrap();
        writeln!(
            file,
            "{}",
            serde_json::json!({"cwd":"/synthetic/after-large-record"})
        )
        .unwrap();
        drop(file);
        let p = Preferences {
            timezone: "America/Chicago".into(),
            claude_roots: vec![root.join("claude").to_string_lossy().into_owned()],
            codex_roots: vec![codex.to_string_lossy().into_owned()],
            ..Default::default()
        };
        let snapshot = engine::scan_with_engine(
            &fixture_engine(),
            &p,
            &dir.path().join("data"),
            &Default::default(),
        )
        .unwrap();
        assert_eq!(snapshot.sessions.len(), 2);
        assert_eq!(
            snapshot.daily.iter().map(|d| d.tokens.total).sum::<u64>(),
            3250
        );
        let session = snapshot
            .sessions
            .iter()
            .find(|s| s.provider == "codex")
            .unwrap();
        assert_eq!(session.tokens.total, 150);
        assert_eq!(session.cost_micros, 614);
        assert_eq!(session.project, "after-large-record");
        assert_eq!(session.title, "Refine the command palette");
        assert_eq!(session.source_status, "metadata incomplete");
        assert!(session.activity_days.is_empty());
        assert!(snapshot
            .warnings
            .iter()
            .any(|w| w.starts_with("Session metadata")));
        assert!(snapshot
            .sources
            .iter()
            .find(|s| s.provider == "codex")
            .unwrap()
            .warning
            .as_ref()
            .unwrap()
            .contains("1 oversized records"));
    }
    #[test]
    #[ignore = "Explicit local-source diagnostic; requires AGENT_USAGE_SOURCE_CHECK_PREFERENCES"]
    fn local_source_snapshot_diagnostic() {
        let path = std::env::var_os("AGENT_USAGE_SOURCE_CHECK_PREFERENCES")
            .expect("Pass an explicit temporary preferences JSON path");
        let prefs: Preferences = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let data = tempfile::tempdir().unwrap();
        let snapshot =
            engine::scan_with_engine(&fixture_engine(), &prefs, data.path(), &Default::default())
                .unwrap();
        assert!(!snapshot.sessions.is_empty());
        let mut attributed = std::collections::BTreeMap::<(&str, &str), (i64, i64)>::new();
        for session in &snapshot.sessions {
            for day in session
                .daily_usage
                .as_ref()
                .expect("bundled engine must retain session days")
            {
                let row = attributed.entry((&day.provider, &day.date)).or_default();
                row.0 += day.cost_micros;
                row.1 += 1;
            }
        }
        for day in &snapshot.daily {
            let (cost, rows) = attributed
                .get(&(day.provider.as_str(), day.date.as_str()))
                .copied()
                .unwrap_or_default();
            assert!(
                (cost - day.cost_micros).abs() <= rows + 1,
                "Session daily usage must reconcile with provider daily usage"
            );
        }
        println!("Verified local snapshot: {} sessions; {} source metadata warnings. No provider files were written.",snapshot.sessions.len(),snapshot.sources.iter().filter(|s|s.warning.is_some()).count());
    }
    #[test]
    fn ten_thousand_rows_paginate_after_grouping() {
        let sessions = (0..10_000)
            .map(|i| Session {
                key: format!("s{i:05}"),
                id: format!("id-{i}"),
                provider: if i % 2 == 0 { "claude" } else { "codex" }.into(),
                title: format!("Session {i}"),
                last_activity: if i % 2 == 0 {
                    "2026-11-01T12:00:00Z"
                } else {
                    "2026-11-02T12:00:00Z"
                }
                .into(),
                activity_days: vec![if i % 2 == 0 {
                    "2026-11-01"
                } else {
                    "2026-11-02"
                }
                .into()],
                cost_micros: i,
                ..Default::default()
            })
            .collect();
        let snapshot = Snapshot {
            sessions,
            timezone: "UTC".into(),
            ..Default::default()
        };
        let q = Query {
            sort: "cost".into(),
            descending: true,
            descending_groups: false,
            offset: 4990,
            limit: 25,
            ..Default::default()
        };
        let start = std::time::Instant::now();
        let v = reports::build(
            snapshot,
            &q,
            &Default::default(),
            &Default::default(),
            false,
        )
        .unwrap();
        assert_eq!(v.session_count, 10_000);
        assert_eq!(v.sessions.len(), 25);
        assert!(v.sessions[0].last_activity < v.sessions[24].last_activity);
        assert_eq!(v.group_totals["2026-11-01"].0, 5000);
        assert!(start.elapsed().as_secs() < 5);
    }
}
