use crate::core::{engine, metadata, reports, storage, types::*};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub dir: PathBuf,
    pub scanning: AtomicBool,
    pub cancelled: AtomicBool,
    pub dirty: AtomicU64,
    pub last_error: Mutex<Option<AppError>>,
    pub tray_available: AtomicBool,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    pub activity: std::sync::Arc<Mutex<crate::core::activity::ActivityReader>>,
}
fn db(state: &AppState) -> Result<rusqlite::Connection> {
    storage::open(&state.dir)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    preferences: Preferences,
    sources: Vec<Source>,
    has_snapshot: bool,
    scanning: bool,
    last_error: Option<AppError>,
    engine_version: &'static str,
    tray_available: bool,
}
#[tauri::command]
pub fn get_bootstrap_status(state: tauri::State<AppState>) -> Result<Bootstrap> {
    let conn = db(&state)?;
    let p = storage::preferences(&conn)?;
    Ok(Bootstrap {
        sources: metadata::roots(&p),
        preferences: p,
        has_snapshot: storage::snapshot(&conn)?.is_some(),
        scanning: state.scanning.load(Ordering::Relaxed),
        last_error: state.last_error.lock().unwrap().clone(),
        engine_version: engine::VERSION,
        tray_available: state.tray_available.load(Ordering::Relaxed),
    })
}
#[tauri::command]
pub fn get_view(query: Query, state: tauri::State<AppState>) -> Result<ViewData> {
    let conn = db(&state)?;
    let s = storage::snapshot(&conn)?.ok_or_else(|| {
        AppError::new(
            "NOT_SCANNED",
            "Refresh to load local usage. No estimates are available yet.",
        )
    })?;
    let p = storage::preferences(&conn)?;
    let stale = state.last_error.lock().unwrap().is_some()
        || p.timezone != s.timezone
        || p.cost_mode != s.cost_mode
        || engine::fingerprint(&p) != s.settings_fingerprint;
    reports::build(
        s,
        &query,
        &storage::annotations(&conn)?,
        &storage::aliases(&conn)?,
        stale,
    )
}
#[tauri::command]
pub async fn get_session_activity(
    keys: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, crate::core::activity::SessionActivity>> {
    if keys.len() > 500 || keys.iter().any(|key| key.len() > 1024) {
        return Err(AppError::new(
            "INVALID_SESSIONS",
            "Too many sessions to inspect at once.",
        ));
    }
    let dir = state.dir.clone();
    let reader = state.activity.clone();
    let (activity, changed) = tauri::async_runtime::spawn_blocking(move || {
        let conn = storage::open(&dir)?;
        let Some(snapshot) = storage::snapshot(&conn)? else {
            return Ok::<_, AppError>((Default::default(), false));
        };
        let preferences = storage::preferences(&conn)?;
        let mut reader = reader.lock().map_err(|_| {
            AppError::new(
                "ACTIVITY_UNAVAILABLE",
                "Session activity is temporarily unavailable.",
            )
        })?;
        let before = reader.revision();
        let activity =
            reader.read_sessions(&snapshot.sessions, &keys, &metadata::roots(&preferences))?;
        Ok((activity, before != reader.revision()))
    })
    .await
    .map_err(|_| {
        AppError::new(
            "ACTIVITY_UNAVAILABLE",
            "Session activity is temporarily unavailable.",
        )
    })??;
    if changed {
        // FSEvents may coalesce appends to an open log. Visible activity polls
        // also invalidate costs so continuous writes still get bounded refreshes.
        state
            .dirty
            .store(chrono::Utc::now().timestamp() as u64, Ordering::Relaxed);
    }
    Ok(activity)
}

#[tauri::command]
pub async fn get_project_icons(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, crate::core::project_icons::ProjectIcon>> {
    if paths.len() > 100 || paths.iter().any(|path| path.len() > 4096) {
        return Err(AppError::new(
            "INVALID_PROJECTS",
            "Too many projects to inspect at once.",
        ));
    }
    let dir = state.dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = storage::open(&dir)?;
        let Some(snapshot) = storage::snapshot(&conn)? else {
            return Ok(Default::default());
        };
        let known: std::collections::HashSet<_> = snapshot
            .sessions
            .iter()
            .map(|s| s.project_path.as_str())
            .collect();
        Ok(paths
            .into_iter()
            .filter(|path| known.contains(path.as_str()))
            .map(|path| {
                let icon = crate::core::project_icons::discover(&path);
                (path, icon)
            })
            .collect())
    })
    .await
    .map_err(|_| {
        AppError::new(
            "ICONS_UNAVAILABLE",
            "Project icons are temporarily unavailable.",
        )
    })?
}

#[tauri::command]
pub fn check_sessions(
    keys: Vec<String>,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<Vec<String>> {
    if keys.len() > 500 || keys.iter().any(|key| key.len() > 1024) {
        return Err(AppError::new(
            "INVALID_SESSIONS",
            "Too many sessions to check at once.",
        ));
    }
    let mut conn = db(&state)?;
    let new_keys = storage::check_sessions(&mut conn, &keys)?;
    crate::tray::sync(&app);
    Ok(new_keys)
}

#[tauri::command]
pub fn get_session_detail(key: String, state: tauri::State<AppState>) -> Result<Session> {
    let conn = db(&state)?;
    let mut s = storage::snapshot(&conn)?
        .ok_or_else(|| AppError::new("NOT_SCANNED", "No snapshot is available."))?
        .sessions
        .into_iter()
        .find(|s| s.key == key)
        .ok_or_else(|| {
            AppError::new(
                "SESSION_MISSING",
                "This session is no longer in the current snapshot.",
            )
        })?;
    if let Some(a) = storage::annotations(&conn)?.get(&key) {
        s.favorite = a.favorite;
        s.tags = a.tags.clone();
        if let Some(t) = &a.title {
            s.title = t.clone();
            s.title_provenance = "local".into();
        }
    }
    if let Some(alias) = storage::aliases(&conn)?
        .get(&s.project_path)
        .filter(|a| !a.is_empty())
    {
        s.project = alias.clone();
    }
    Ok(s)
}
#[tauri::command]
pub fn update_session_metadata(
    key: String,
    mut changes: Annotation,
    state: tauri::State<AppState>,
) -> Result<()> {
    if changes.tags.len() > 20 || changes.tags.iter().any(|s| s.chars().count() > 40) {
        return Err(AppError::new(
            "INVALID_METADATA",
            "Use up to 20 tags, each at most 40 characters.",
        ));
    }
    changes.title = changes.title.and_then(|s| metadata::bounded_title(&s));
    storage::save_annotation(&db(&state)?, &key, &changes)
}
#[tauri::command]
pub fn set_project_alias(path: String, alias: String, state: tauri::State<AppState>) -> Result<()> {
    let alias: String = alias.chars().filter(|c| !c.is_control()).take(80).collect();
    db(&state)?.execute(
        "INSERT OR REPLACE INTO projects VALUES (?1,?2)",
        rusqlite::params![path, alias],
    )?;
    Ok(())
}
fn validate_preferences(p: &Preferences) -> Result<()> {
    for allowance in [
        p.claude_monthly_allowance_usd,
        p.codex_monthly_allowance_usd,
    ]
    .into_iter()
    .flatten()
    {
        if !allowance.is_finite() || allowance <= 0.0 {
            return Err(AppError::new(
                "INVALID_ALLOWANCE",
                "Monthly allowances must be positive USD amounts, or left blank.",
            ));
        }
    }
    if p.engine_path
        .as_ref()
        .is_some_and(|s| s.is_empty() || !std::path::Path::new(s).is_absolute())
    {
        return Err(AppError::new(
            "INVALID_ENGINE_PATH",
            "Choose an absolute executable path, or switch to the bundled engine.",
        ));
    }
    if p.timezone != "local" && p.timezone.parse::<chrono_tz::Tz>().is_err() {
        return Err(AppError::new(
            "INVALID_TIMEZONE",
            "Choose a valid IANA timezone.",
        ));
    }
    if !["auto", "calculate", "display"].contains(&p.cost_mode.as_str())
        || !["auto", "standard", "flex", "fast"].contains(&p.codex_speed.as_str())
        || !["system", "light", "dark"].contains(&p.theme.as_str())
    {
        return Err(AppError::new(
            "INVALID_PREFERENCES",
            "Unsupported preference value.",
        ));
    }
    if p.foreground_seconds < 30
        || p.foreground_seconds > 3600
        || ![0, 60, 300, 900].contains(&p.background_seconds)
    {
        return Err(AppError::new(
            "INVALID_INTERVAL",
            "Choose a supported refresh interval.",
        ));
    }
    for root in p.claude_roots.iter().chain(&p.codex_roots) {
        if !PathBuf::from(root).is_absolute() || root.contains(',') {
            return Err(AppError::new(
                "INVALID_SOURCE",
                "Source roots must be absolute paths without commas.",
            ));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn set_preferences(
    preferences: Preferences,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<Preferences> {
    validate_preferences(&preferences)?;
    let mut conn = db(&state)?;
    let old = storage::preferences(&conn)?;
    storage::save_preferences(&conn, &preferences)?;
    if !preferences.prompt_fallback {
        storage::purge_prompt_titles(&mut conn)?;
    }
    if old.timezone != preferences.timezone
        || old.cost_mode != preferences.cost_mode
        || old.codex_speed != preferences.codex_speed
        || old.claude_roots != preferences.claude_roots
        || old.codex_roots != preferences.codex_roots
        || old.engine_path != preferences.engine_path
    {
        *state.last_error.lock().unwrap() = Some(AppError::new(
            "SETTINGS_CHANGED",
            "Refresh to verify data using the new settings.",
        ));
    }
    watch(&app, &preferences);
    crate::tray::sync(&app);
    Ok(preferences)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDiagnostics {
    version: String,
    source: String,
    revision: &'static str,
}
#[tauri::command]
pub async fn test_engine(app: tauri::AppHandle) -> Result<EngineDiagnostics> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let p = storage::preferences(&db(&state)?)?;
        let path = engine::selected(&app, &p)?;
        let version = engine::probe(&path, &state.dir)?;
        Ok(EngineDiagnostics {
            version,
            source: if p.engine_path.is_some() {
                "external"
            } else {
                "bundled"
            }
            .into(),
            revision: engine::REVISION,
        })
    })
    .await
    .map_err(|_| AppError::new("ENGINE_TASK", "Engine test stopped unexpectedly."))?
}
#[tauri::command]
pub async fn refresh_usage(app: tauri::AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || refresh(&app))
        .await
        .map_err(|_| AppError::new("REFRESH_TASK", "Refresh stopped unexpectedly."))?
}
struct ScanGuard<'a>(&'a AtomicBool);
impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
pub fn refresh(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err(AppError::new(
            "REFRESH_BUSY",
            "A refresh is already running.",
        ));
    }
    state.cancelled.store(false, Ordering::SeqCst);
    let _guard = ScanGuard(&state.scanning);
    let _ = app.emit("usage-refreshing", true);
    let result = (|| {
        let mut conn = db(&state)?;
        let p = storage::preferences(&conn)?;
        let started = metadata::now();
        conn.execute(
            "INSERT INTO refresh_runs(started_at,status) VALUES (?1,'running')",
            [started],
        )?;
        let id = conn.last_insert_rowid();
        let result = engine::scan(app, &p, &state.dir, &state.cancelled);
        let result = if state.cancelled.load(Ordering::SeqCst) {
            Err(AppError::new(
                "REFRESH_CANCELLED",
                "Refresh cancelled. Previous data has been kept.",
            ))
        } else {
            result
        };
        match result {
            Ok(snapshot) => {
                storage::save_snapshot(&mut conn, &snapshot)?;
                conn.execute(
                    "UPDATE refresh_runs SET finished_at=?1,status='success' WHERE id=?2",
                    rusqlite::params![metadata::now(), id],
                )?;
                Ok(())
            }
            Err(e) => {
                conn.execute("UPDATE refresh_runs SET finished_at=?1,status='failed',error_code=?2 WHERE id=?3",rusqlite::params![metadata::now(),e.code,id])?;
                Err(e)
            }
        }
    })();
    *state.last_error.lock().unwrap() = result.as_ref().err().cloned();
    drop(_guard);
    let _ = app.emit("usage-updated", result.as_ref().err());
    crate::tray::sync(app);
    result
}
#[tauri::command]
pub fn clear_cache(state: tauri::State<AppState>) -> Result<()> {
    state.cancelled.store(true, Ordering::SeqCst);
    db(&state)?.execute("DELETE FROM snapshots", [])?;
    *state.last_error.lock().unwrap() = None;
    Ok(())
}
#[tauri::command]
pub fn open_local_target(
    key: Option<String>,
    target: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<()> {
    let path = if target == "data" {
        state.dir.clone()
    } else {
        let session = get_session_detail(
            key.ok_or_else(|| AppError::new("INVALID_TARGET", "Choose a session first."))?,
            state,
        )?;
        match target.as_str() {
            "project" => PathBuf::from(session.project_path),
            "source" => PathBuf::from(
                session
                    .source_path
                    .ok_or_else(|| AppError::new("SOURCE_MISSING", "Source path is unknown."))?,
            ),
            _ => return Err(AppError::new("INVALID_TARGET", "Unsupported local action.")),
        }
    };
    if !path.is_absolute() || !path.exists() {
        return Err(AppError::new(
            "PATH_UNAVAILABLE",
            "The local path is unavailable.",
        ));
    }
    if target == "source" {
        app.opener().reveal_item_in_dir(path)
    } else {
        app.opener().open_path(path.to_string_lossy(), None::<&str>)
    }
    .map_err(|_| AppError::new("OPEN_FAILED", "The system could not open this local path."))
}
#[tauri::command]
pub fn get_diagnostics(state: tauri::State<AppState>) -> Result<serde_json::Value> {
    let conn = db(&state)?;
    let p = storage::preferences(&conn)?;
    let s = storage::snapshot(&conn)?;
    Ok(
        serde_json::json!({"appVersion":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"engineVersion":engine::VERSION,"engineRevision":engine::REVISION,"engineSource":if p.engine_path.is_some(){"external"}else{"bundled"},"hasSnapshot":s.is_some(),"trayAvailable":state.tray_available.load(Ordering::Relaxed),"lastVerified":s.as_ref().map(|s|&s.scanned_at),"sessionCount":s.map(|s|s.sessions.len()),"lastErrorCode":state.last_error.lock().unwrap().as_ref().map(|e|e.code.clone())}),
    )
}
pub fn watch(app: &tauri::AppHandle, p: &Preferences) {
    use notify::Watcher;
    let handle = app.clone();
    if let Ok(mut watcher) =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok_and(|e| {
                matches!(
                    e.kind,
                    notify::EventKind::Create(_)
                        | notify::EventKind::Modify(_)
                        | notify::EventKind::Remove(_)
                )
            }) {
                handle
                    .state::<AppState>()
                    .dirty
                    .store(chrono::Utc::now().timestamp() as u64, Ordering::Relaxed);
            }
        })
    {
        for source in metadata::roots(p).iter().filter(|s| s.status == "ready") {
            let root = PathBuf::from(&source.root);
            for sub in if source.provider == "claude" {
                vec!["projects"]
            } else {
                vec!["sessions", "archived_sessions"]
            } {
                let _ = watcher.watch(&root.join(sub), notify::RecursiveMode::Recursive);
            }
        }
        *app.state::<AppState>().watcher.lock().unwrap() = Some(watcher);
    }
}
fn refresh_due(last: u64, now: u64, dirty: u64, interval: u64, visible: bool) -> bool {
    let periodic = interval > 0 && now.saturating_sub(last) >= interval;
    let pending_changes = dirty > 0 && dirty >= last;
    periodic
        || (pending_changes
            && (now.saturating_sub(dirty) >= 5 || (visible && now.saturating_sub(last) >= 10)))
}

pub fn schedule(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = 0u64;
        let mut tray_day = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let state = app.state::<AppState>();
            let Ok(conn) = db(&state) else {
                continue;
            };
            let Ok(p) = storage::preferences(&conn) else {
                continue;
            };
            if crate::tray::day_changed(&mut tray_day, &metadata::now(), &p.timezone) {
                crate::tray::sync(&app);
                let _ = app.emit("tray-day-changed", ());
            }
            if !p.onboarded || state.scanning.load(Ordering::Relaxed) {
                continue;
            }
            let visible = ["main", "tray"].iter().any(|label| {
                app.get_webview_window(label).is_some_and(|w| {
                    w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)
                })
            });
            let interval = if visible {
                p.foreground_seconds
            } else {
                p.background_seconds
            };
            let now = chrono::Utc::now().timestamp() as u64;
            let dirty = state.dirty.load(Ordering::Relaxed);
            if refresh_due(last, now, dirty, interval, visible) {
                last = now;
                // Keep checking the calendar even while a slow scan crosses midnight.
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = refresh(&handle);
                });
            }
        }
    });
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub metadata: serde_json::Value,
    pub rows: Vec<serde_json::Value>,
}
#[tauri::command]
pub fn export_report(
    report: String,
    query: Query,
    format: String,
    state: tauri::State<AppState>,
) -> Result<String> {
    let conn = db(&state)?;
    let snapshot = storage::snapshot(&conn)?
        .ok_or_else(|| AppError::new("NOT_SCANNED", "No data is available to export."))?;
    let p = storage::preferences(&conn)?;
    let mut q = query.clone();
    q.offset = 0;
    q.limit = 500;
    let annotations = storage::annotations(&conn)?;
    let aliases = storage::aliases(&conn)?;
    let view = reports::build(
        snapshot.clone(),
        &q,
        &annotations,
        &aliases,
        state.last_error.lock().unwrap().is_some(),
    )?;
    let metadata = serde_json::json!({"generatedAt":metadata::now(),"filters":query,"timezone":view.timezone,"providers":query.providers,"since":query.since,"until":query.until,"costMode":view.cost_mode,"costSemantics":"Estimated USD API-equivalent token value, not subscription charges","ccusageVersion":view.engine_version,"lastVerified":view.scanned_at,"stale":view.stale,"sourceCoverage":view.sources.iter().map(|s|serde_json::json!({"provider":s.provider,"status":s.status})).collect::<Vec<_>>(),"attribution":"event day within selected period"});
    let mut rows: Vec<serde_json::Value> = vec![];
    match report.as_str() {
        "sessions" => loop {
            let page = reports::build(snapshot.clone(), &q, &annotations, &aliases, view.stale)?;
            for s in page.sessions {
                rows.push(serde_json::json!({"id":s.id,"title":s.title,"provider":s.provider,"project":s.project,"firstActivity":s.first_activity,"firstUsageDate":metadata::first_usage_date(&s, &view.timezone),"activeDays":metadata::session_activity_days(&s).len(),"lastActivity":s.last_activity,"estimatedUsd":s.period_cost_micros.map(|cost| cost as f64/1e6),"totalTokens":s.tokens.total,"inputTokens":s.tokens.input,"outputTokens":s.tokens.output,"cacheReadTokens":s.tokens.cache_read,"cacheCreationTokens":s.tokens.cache_creation,"missingPricing":s.missing_pricing}));
            }
            q.offset += q.limit;
            if q.offset >= page.session_count {
                break;
            }
        },
        "projects" => {
            for r in view.projects {
                rows.push(serde_json::json!({"project":r.name,"sessions":r.sessions,"estimatedUsd":r.period_cost_micros.map(|cost| cost as f64/1e6),"totalTokens":r.tokens.total}));
            }
        }
        "models" => {
            for r in view.models {
                rows.push(serde_json::json!({"model":r.model,"estimatedUsd":r.cost_micros as f64/1e6,"inputTokens":r.tokens.input,"outputTokens":r.tokens.output,"cacheReadTokens":r.tokens.cache_read,"cacheCreationTokens":r.tokens.cache_creation,"missingPricing":r.missing_pricing}));
            }
        }
        "daily" | "weekly" | "monthly" => {
            use chrono::Datelike;
            let mut groups: std::collections::BTreeMap<(String, String), DailyUsage> =
                Default::default();
            for r in view.daily {
                let date = chrono::NaiveDate::parse_from_str(&r.date, "%Y-%m-%d").unwrap();
                let bucket = match report.as_str() {
                    "monthly" => format!("{}-{:02}", date.year(), date.month()),
                    "weekly" => {
                        let offset = if p.week_start == "sunday" {
                            date.weekday().num_days_from_sunday()
                        } else {
                            date.weekday().num_days_from_monday()
                        };
                        (date - chrono::Duration::days(offset as i64)).to_string()
                    }
                    _ => r.date.clone(),
                };
                let d = groups
                    .entry((bucket.clone(), r.provider.clone()))
                    .or_insert_with(|| DailyUsage {
                        date: bucket,
                        provider: r.provider.clone(),
                        ..Default::default()
                    });
                d.cost_micros += r.cost_micros;
                d.tokens.add(&r.tokens);
                d.missing_pricing |= r.missing_pricing;
            }
            for r in groups.into_values() {
                rows.push(serde_json::json!({"date":r.date,"provider":r.provider,"estimatedUsd":r.cost_micros as f64/1e6,"totalTokens":r.tokens.total,"inputTokens":r.tokens.input,"outputTokens":r.tokens.output,"cacheReadTokens":r.tokens.cache_read,"cacheCreationTokens":r.tokens.cache_creation,"missingPricing":r.missing_pricing}));
            }
        }
        _ => return Err(AppError::new("INVALID_REPORT", "Unknown report type.")),
    }
    if format == "json" {
        return Ok(serde_json::to_string_pretty(&ExportData { metadata, rows }).unwrap());
    }
    if format != "csv" {
        return Err(AppError::new("INVALID_FORMAT", "Choose CSV or JSON."));
    }
    let mut out = format!(
        "{},{}\r\n",
        reports::csv_cell("metadata"),
        reports::csv_cell(&metadata.to_string())
    );
    if let Some(first) = rows.first().and_then(|v| v.as_object()) {
        let columns: Vec<_> = first.keys().cloned().collect();
        out.push_str(
            &columns
                .iter()
                .map(|s| reports::csv_cell(s))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push_str("\r\n");
        for row in rows {
            out.push_str(
                &columns
                    .iter()
                    .map(|k| {
                        let v = &row[k];
                        reports::csv_cell(v.as_str().unwrap_or(&v.to_string()))
                    })
                    .collect::<Vec<_>>()
                    .join(","),
            );
            out.push_str("\r\n");
        }
    }
    Ok(out)
}
#[tauri::command]
pub async fn save_report(
    report: String,
    query: Query,
    format: String,
    app: tauri::AppHandle,
) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let state = app.state::<AppState>();
        let content = export_report(report.clone(), query, format.clone(), state)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!("usage-{report}.{format}"))
            .add_filter("Usage report", &[format.as_str()])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| AppError::new("EXPORT_PATH", "Choose a local destination."))?;
        std::fs::write(&path, content).map_err(|_| {
            AppError::new(
                "EXPORT_WRITE",
                "Could not save the report to that destination.",
            )
        })?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| AppError::new("EXPORT_TASK", "Export was interrupted."))?
}
#[tauri::command]
pub async fn choose_local_path(kind: String, app: tauri::AppHandle) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let dialog = app.dialog().file();
        let selected = match kind.as_str() {
            "folder" => dialog.blocking_pick_folder(),
            "file" => dialog.blocking_pick_file(),
            _ => return Err(AppError::new("INVALID_TARGET", "Choose a file or folder.")),
        };
        selected
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|_| AppError::new("INVALID_PATH", "Choose a local path."))
            })
            .transpose()
    })
    .await
    .map_err(|_| AppError::new("DIALOG_TASK", "File selection was interrupted."))?
}

#[tauri::command]
pub fn cancel_refresh(state: tauri::State<AppState>) {
    state.cancelled.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod refresh_tests {
    use super::refresh_due;
    #[test]
    fn monthly_allowances_must_be_positive_finite_or_unset() {
        use super::{validate_preferences, Preferences};
        for amount in [None, Some(0.01), Some(150.5)] {
            let p = Preferences {
                claude_monthly_allowance_usd: amount,
                codex_monthly_allowance_usd: amount,
                ..Default::default()
            };
            assert!(validate_preferences(&p).is_ok());
        }
        for amount in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for provider in ["claude", "codex"] {
                let mut p = Preferences::default();
                if provider == "claude" {
                    p.claude_monthly_allowance_usd = Some(amount);
                } else {
                    p.codex_monthly_allowance_usd = Some(amount);
                }
                assert_eq!(
                    validate_preferences(&p).unwrap_err().code,
                    "INVALID_ALLOWANCE"
                );
            }
        }
    }
    #[test]
    fn visible_unfocused_windows_refresh_during_continuous_writes() {
        assert!(!refresh_due(100, 108, 108, 60, true));
        assert!(refresh_due(100, 110, 110, 60, true));
        assert!(refresh_due(100, 106, 101, 60, true));
        assert!(!refresh_due(100, 110, 110, 300, false));
        assert!(refresh_due(100, 400, 400, 300, false));
    }
    #[test]
    fn no_changes_do_not_force_scans_and_same_second_writes_are_not_lost() {
        assert!(!refresh_due(100, 110, 99, 60, true));
        assert!(!refresh_due(100, 110, 0, 0, true));
        assert!(refresh_due(100, 110, 100, 60, true));
        assert!(refresh_due(100, 160, 0, 60, true));
    }
}
