use super::types::*;
use rusqlite::{params, Connection};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

pub fn open(dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(dir).map_err(|_| {
        AppError::new(
            "DATA_DIRECTORY",
            "Cannot create application data directory.",
        )
    })?;
    let db = Connection::open(dir.join("usage.sqlite"))?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS annotations (session_key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (path TEXT PRIMARY KEY, alias TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checked_sessions (session_key TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS refresh_runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error_code TEXT);
      PRAGMA user_version=1;")?;
    initialize_session_checks(&db)?;
    Ok(db)
}
// Seed existing history once when upgrading or importing the first snapshot.
fn initialize_session_checks(db: &Connection) -> Result<()> {
    let initialized: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM preferences WHERE key='session_checks_initialized')",
        [],
        |r| r.get(0),
    )?;
    if initialized {
        return Ok(());
    }
    db.execute_batch("BEGIN IMMEDIATE;
        INSERT OR IGNORE INTO checked_sessions(session_key)
            SELECT json_extract(session.value, '$.key') FROM snapshots, json_each(snapshots.json, '$.sessions') AS session
            WHERE NOT EXISTS(SELECT 1 FROM preferences WHERE key='session_checks_initialized');
        INSERT OR IGNORE INTO preferences(key,value)
            SELECT 'session_checks_initialized','true' WHERE EXISTS(SELECT 1 FROM snapshots);
        COMMIT;")?;
    Ok(())
}

pub fn checked_session_keys(db: &Connection) -> Result<HashSet<String>> {
    let mut stmt = db.prepare("SELECT session_key FROM checked_sessions")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<std::result::Result<HashSet<_>, _>>()?)
}

pub fn check_sessions(db: &mut Connection, keys: &[String]) -> Result<Vec<String>> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut new_keys = Vec::new();
    for key in keys {
        if tx.execute(
            "INSERT OR IGNORE INTO checked_sessions(session_key) VALUES (?1)",
            [key],
        )? > 0
        {
            new_keys.push(key.clone());
        }
    }
    tx.commit()?;
    Ok(new_keys)
}

pub fn preferences(db: &Connection) -> Result<Preferences> {
    let value: std::result::Result<String, _> =
        db.query_row("SELECT value FROM preferences WHERE key='app'", [], |r| {
            r.get(0)
        });
    match value {
        Ok(v) => serde_json::from_str(&v)
            .map_err(|_| AppError::new("PREFERENCES", "Saved preferences are invalid.")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Preferences::default()),
        Err(e) => Err(e.into()),
    }
}
pub fn save_preferences(db: &Connection, p: &Preferences) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO preferences VALUES ('app',?1)",
        [serde_json::to_string(p).unwrap()],
    )?;
    Ok(())
}
pub fn snapshot(db: &Connection) -> Result<Option<Snapshot>> {
    let value: std::result::Result<String, _> =
        db.query_row("SELECT json FROM snapshots WHERE id=1", [], |r| r.get(0));
    match value {
        Ok(v) => serde_json::from_str(&v).map(Some).map_err(|_| {
            AppError::new(
                "CACHE_INVALID",
                "Cached snapshot is invalid. Rebuild the cache.",
            )
        }),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
pub fn save_snapshot(db: &mut Connection, s: &Snapshot) -> Result<()> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut current = s.clone();
    if !preferences(&tx)?.prompt_fallback {
        for row in &mut current.sessions {
            if row.title_provenance == "prompt" {
                row.title = super::metadata::fallback_title(&row.project, &row.id);
                row.title_provenance = "identifier".into();
            }
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO snapshots VALUES (1,?1)",
        [serde_json::to_string(&current).unwrap()],
    )?;
    tx.execute("DELETE FROM refresh_runs WHERE id NOT IN (SELECT id FROM refresh_runs ORDER BY id DESC LIMIT 50)", [])?;
    tx.commit()?;
    initialize_session_checks(db)?;
    Ok(())
}
pub fn annotations(db: &Connection) -> Result<HashMap<String, Annotation>> {
    let mut stmt = db.prepare("SELECT session_key,json FROM annotations")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        if let Ok(a) = serde_json::from_str(&v) {
            out.insert(k, a);
        }
    }
    Ok(out)
}
pub fn save_annotation(db: &Connection, key: &str, a: &Annotation) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO annotations VALUES (?1,?2)",
        params![key, serde_json::to_string(a).unwrap()],
    )?;
    Ok(())
}
pub fn aliases(db: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = db.prepare("SELECT path,alias FROM projects")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<HashMap<String, String>, _>>()?)
}
pub fn purge_prompt_titles(db: &mut Connection) -> Result<()> {
    if let Some(mut s) = snapshot(db)? {
        for row in &mut s.sessions {
            if row.title_provenance == "prompt" {
                row.title = super::metadata::fallback_title(&row.project, &row.id);
                row.title_provenance = "identifier".into();
            }
        }
        save_snapshot(db, &s)?;
    }
    Ok(())
}
pub fn last_failure(db: &Connection) -> Result<Option<AppError>> {
    let row = db.query_row(
        "SELECT status,error_code FROM refresh_runs ORDER BY id DESC LIMIT 1",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
    );
    match row {
        Ok((status, code)) if status != "success" => Ok(Some(AppError::new(
            code.as_deref().unwrap_or("SCAN_INTERRUPTED"),
            "The last scan did not finish successfully. Refresh to verify the cached snapshot.",
        ))),
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_checks_persist_and_only_acknowledge_the_sessions_shown() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open(dir.path()).unwrap();
        let mut snapshot = Snapshot {
            sessions: vec![Session {
                key: "existing".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        save_snapshot(&mut db, &snapshot).unwrap();
        assert!(check_sessions(&mut db, &["existing".into()])
            .unwrap()
            .is_empty());
        snapshot.sessions.extend([
            Session {
                key: "new-claude".into(),
                ..Default::default()
            },
            Session {
                key: "new-codex".into(),
                ..Default::default()
            },
        ]);
        save_snapshot(&mut db, &snapshot).unwrap();
        assert!(!checked_session_keys(&db).unwrap().contains("new-codex"));
        assert_eq!(
            check_sessions(&mut db, &["new-claude".into(), "new-claude".into()]).unwrap(),
            vec!["new-claude"]
        );
        drop(db);
        let mut other_window = open(dir.path()).unwrap();
        assert!(check_sessions(&mut other_window, &["new-claude".into()])
            .unwrap()
            .is_empty());
        assert_eq!(
            check_sessions(&mut other_window, &["new-codex".into()]).unwrap(),
            vec!["new-codex"]
        );
        snapshot.sessions[0].last_activity = "2030-01-01T00:00:00Z".into();
        save_snapshot(&mut other_window, &snapshot).unwrap();
        assert!(check_sessions(&mut other_window, &["existing".into()])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn upgrade_initializes_existing_history_once_without_a_badge_flood() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open(dir.path()).unwrap();
        let snapshot = Snapshot {
            sessions: vec![Session {
                key: "historic".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        save_snapshot(&mut db, &snapshot).unwrap();
        db.execute(
            "DELETE FROM preferences WHERE key='session_checks_initialized'",
            [],
        )
        .unwrap();
        db.execute("DROP TABLE checked_sessions", []).unwrap();
        drop(db);
        let mut db = open(dir.path()).unwrap();
        assert!(check_sessions(&mut db, &["historic".into()])
            .unwrap()
            .is_empty());
        assert_eq!(
            check_sessions(&mut db, &["later".into()]).unwrap(),
            vec!["later"]
        );
    }

    #[test]
    fn cache_replacement_preserves_annotations_and_privacy() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open(dir.path()).unwrap();
        let annotation = Annotation {
            title: Some("Local name".into()),
            favorite: true,
            tags: vec!["review".into()],
        };
        save_annotation(&db, "claude:a:s", &annotation).unwrap();
        let snapshot = Snapshot {
            scanned_at: "2026-11-01T12:00:00Z".into(),
            sessions: vec![Session {
                key: "claude:a:s".into(),
                id: "s".into(),
                project: "Demo".into(),
                title: "A sensitive prompt title".into(),
                title_provenance: "prompt".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        save_snapshot(&mut db, &snapshot).unwrap();
        purge_prompt_titles(&mut db).unwrap();
        let read = super::snapshot(&db).unwrap().unwrap();
        assert_eq!(read.sessions[0].title_provenance, "identifier");
        assert!(!serde_json::to_string(&read)
            .unwrap()
            .contains("sensitive prompt"));
        assert_eq!(
            annotations(&db).unwrap()["claude:a:s"].title,
            Some("Local name".into())
        );
        save_snapshot(&mut db, &Snapshot::default()).unwrap();
        assert!(super::snapshot(&db).unwrap().unwrap().sessions.is_empty());
        assert!(annotations(&db).unwrap()["claude:a:s"].favorite);
    }
    #[test]
    fn migration_and_preferences_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let db = open(dir.path()).unwrap();
            let p = Preferences {
                timezone: "Asia/Tokyo".into(),
                claude_monthly_allowance_usd: Some(100.5),
                codex_monthly_allowance_usd: Some(200.0),
                ..Default::default()
            };
            save_preferences(&db, &p).unwrap();
        }
        let db = open(dir.path()).unwrap();
        assert_eq!(preferences(&db).unwrap().timezone, "Asia/Tokyo");
        let p = preferences(&db).unwrap();
        assert_eq!(p.claude_monthly_allowance_usd, Some(100.5));
        assert_eq!(p.codex_monthly_allowance_usd, Some(200.0));
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn old_preferences_default_to_no_monthly_allowances() {
        let p: Preferences = serde_json::from_str(r#"{"timezone":"UTC"}"#).unwrap();
        assert_eq!(p.claude_monthly_allowance_usd, None);
        assert_eq!(p.codex_monthly_allowance_usd, None);
    }
}
