use super::{metadata, types::*};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
pub const VERSION: &str = "20.0.48";
pub const REVISION: &str = "2c92293e0a1d6a395c6a10a23267855e3205a1a6";
pub const TARGET: &str = env!("AGENT_USAGE_TARGET");

pub fn bundled(app: &tauri::AppHandle) -> Result<PathBuf> {
    let exe = std::env::current_exe()
        .map_err(|_| AppError::new("ENGINE_MISSING", "Cannot locate the bundled engine."))?;
    let name = if cfg!(windows) {
        "ccusage.exe"
    } else {
        "ccusage"
    };
    let packaged = exe.parent().unwrap_or(Path::new(".")).join(name);
    if packaged.is_file() {
        return Ok(packaged);
    }
    let target = TARGET;
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "ccusage-{target}{}",
            if cfg!(windows) { ".exe" } else { "" }
        ));
    if cfg!(debug_assertions) && dev.is_file() {
        return Ok(dev);
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| {
            AppError::new(
                "ENGINE_MISSING",
                "Bundled engine resource directory unavailable.",
            )
        })?
        .join(name);
    if resource.is_file() {
        Ok(resource)
    } else {
        Err(AppError::new("ENGINE_MISSING","Bundled ccusage is missing. Build it with pnpm engine:build, or choose an existing executable in Settings."))
    }
}
pub fn selected(app: &tauri::AppHandle, p: &Preferences) -> Result<PathBuf> {
    match &p.engine_path {
        Some(s) if !s.is_empty() => {
            let path = PathBuf::from(s);
            if !path.is_absolute() || !path.is_file() {
                Err(AppError::new("EXTERNAL_ENGINE_MISSING","The selected executable is unavailable. Choose it again or switch to bundled in Settings."))
            } else {
                Ok(path)
            }
        }
        _ => bundled(app),
    }
}
pub fn run(path: &Path, args: &[String], dir: &Path, sources: &[Source]) -> Result<Vec<u8>> {
    run_cancellable(path, args, dir, sources, None)
}
fn run_cancellable(
    path: &Path,
    args: &[String],
    dir: &Path,
    sources: &[Source],
    cancelled: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Vec<u8>> {
    let empty = dir.join("engine-home");
    std::fs::create_dir_all(&empty)
        .map_err(|_| AppError::new("DATA_DIRECTORY", "Cannot prepare engine environment."))?;
    let mut cmd = Command::new(path);
    cmd.args(args)
        .current_dir(&empty)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for key in ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"] {
        if let Some(v) = std::env::var_os(key) {
            cmd.env(key, v);
        }
    }
    cmd.env("HOME", &empty)
        .env("USERPROFILE", &empty)
        .env("AGENT_USAGE_SESSION_USAGE", "1")
        .env("NO_COLOR", "1");
    for (provider, key) in [("claude", "CLAUDE_CONFIG_DIR"), ("codex", "CODEX_HOME")] {
        let roots = sources
            .iter()
            .filter(|s| s.provider == provider && s.status == "ready")
            .map(|s| s.root.as_str())
            .collect::<Vec<_>>()
            .join(",");
        // An explicitly empty CLAUDE_CONFIG_DIR is an upstream error; unset means no source in the isolated home.
        if !roots.is_empty() {
            cmd.env(key, roots);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|_| {
        AppError::new(
            "ENGINE_LAUNCH",
            "Could not launch ccusage. Check the selected executable and its permissions.",
        )
    })?;
    #[cfg(windows)]
    let job = match super::windows_job::Job::attach(&child) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || {
        let mut b = vec![];
        stdout
            .take(64 * 1024 * 1024 + 1)
            .read_to_end(&mut b)
            .map(|_| b)
    });
    let err = thread::spawn(move || {
        let mut b = vec![];
        stderr.take(256 * 1024 + 1).read_to_end(&mut b).map(|_| b)
    });
    let start = Instant::now();
    let mut was_cancelled = false;
    let status = loop {
        if cancelled.is_some_and(|c| c.load(std::sync::atomic::Ordering::Relaxed)) {
            was_cancelled = true;
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() < Duration::from_secs(120) => {
                thread::sleep(Duration::from_millis(50))
            }
            _ => {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    // The standalone engine has no children; clean any descendants from external engines too.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    drop(job);
    let output = out
        .join()
        .ok()
        .and_then(|v| v.ok())
        .ok_or_else(|| AppError::new("ENGINE_IO", "Could not read engine output."))?;
    let errors = err.join().ok().and_then(|v| v.ok()).unwrap_or_default();
    if was_cancelled {
        return Err(AppError::new(
            "REFRESH_CANCELLED",
            "Refresh cancelled. Previous verified data has been kept.",
        ));
    }
    if status.is_none() {
        return Err(AppError::new(
            "ENGINE_TIMEOUT",
            "ccusage exceeded the 120-second limit. Previous data has been kept.",
        ));
    }
    if output.len() > 64 * 1024 * 1024 || errors.len() > 256 * 1024 {
        return Err(AppError::new(
            "ENGINE_OUTPUT_LIMIT",
            "Engine output exceeded the safety limit. Narrow the configured sources.",
        ));
    }
    if !status.unwrap().success() {
        return Err(AppError::new("ENGINE_FAILED","ccusage could not complete the scan. Check source access, configuration, and engine compatibility. Previous data has been kept."));
    }
    // Stderr can contain private source paths or model warnings. Never persist it.
    Ok(output)
}
pub fn probe(path: &Path, dir: &Path) -> Result<String> {
    let bytes = run(path, &["--version".into()], dir, &[])?;
    let v = String::from_utf8_lossy(&bytes);
    let version = v.trim().trim_start_matches("ccusage ");
    if version != VERSION {
        return Err(AppError::new("ENGINE_INCOMPATIBLE","This adapter is verified with ccusage 20.0.48. Select that version or use the bundled engine."));
    }
    Ok(version.into())
}
pub fn fingerprint(p: &Preferences) -> String {
    metadata::stable_id(&serde_json::json!({"timezone":p.timezone,"mode":p.cost_mode,"speed":p.codex_speed,"engine":p.engine_path,"revision":REVISION,"sessionUsage":1,"sources":metadata::roots(p).iter().map(|s|(&s.provider,&s.root)).collect::<Vec<_>>()}).to_string())
}
pub fn scan(
    app: &tauri::AppHandle,
    p: &Preferences,
    dir: &Path,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Result<Snapshot> {
    let path = selected(app, p)?;
    scan_with_engine(&path, p, dir, cancelled)
}
pub(crate) fn scan_with_engine(
    path: &Path,
    p: &Preferences,
    dir: &Path,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Result<Snapshot> {
    let version = probe(path, dir)?;
    let mut sources = metadata::roots(p);
    if sources.iter().any(|s| s.status == "unreadable") {
        return Err(AppError::new(
            "SOURCE_UNREADABLE",
            "A configured source is inaccessible. Previous verified data has been kept.",
        ));
    }
    if sources.iter().any(|s| {
        s.provider == "claude"
            && std::path::Path::new(&s.root)
                .components()
                .any(|c| c.as_os_str() == "projects")
    }) {
        return Err(AppError::new("SOURCE_PATH_INCOMPATIBLE","ccusage 20.0.48 cannot reliably identify Claude sessions when an ancestor directory is named projects. Select the standard Claude config root."));
    }
    if !sources.iter().any(|s| s.status == "ready") {
        return Err(AppError::new(
            "NO_SOURCES",
            "No readable Claude Code or Codex logs found. Configure source roots in Settings.",
        ));
    }
    let config = dir.join("engine-config.json");
    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({"codex":{"defaults":{"speed":p.codex_speed}}}))
            .unwrap(),
    )
    .map_err(|_| {
        AppError::new(
            "ENGINE_CONFIG",
            "Cannot write the app-owned engine configuration.",
        )
    })?;
    let args = vec![
        "daily".into(),
        "--sections".into(),
        "daily,session".into(),
        "--by-agent".into(),
        "--json".into(),
        "--breakdown".into(),
        "--mode".into(),
        p.cost_mode.clone(),
        "--timezone".into(),
        p.timezone.clone(),
        "--offline".into(),
        "--config".into(),
        config.to_string_lossy().into(),
    ];
    let mut sessions = vec![];
    let mut daily = vec![];
    // Isolate roots: native IDs may collide between separate provider installations.
    for source in sources.iter().filter(|s| s.status == "ready") {
        let bytes = run_cancellable(
            path,
            &args,
            dir,
            std::slice::from_ref(source),
            Some(cancelled),
        )?;
        let (mut root_sessions, root_daily) = super::usage::parse(&bytes)?;
        root_sessions.retain(|s| s.provider == source.provider);
        for row in &mut root_sessions {
            row.source_id = source.id.clone();
        }
        sessions.extend(root_sessions);
        daily.extend(
            root_daily
                .into_iter()
                .filter(|r| r.provider == source.provider),
        );
    }
    let enrichment = metadata::enrich(&mut sessions, &mut sources, p);
    if enrichment.source_access_failed {
        return Err(AppError::new(
            "SOURCE_PARTIAL",
            "Some source files are inaccessible. Check source permissions, then refresh. The previous snapshot has been kept.",
        ));
    }
    let mut warnings = enrichment.warnings;
    warnings.push("Offline pricing snapshot bundled with ccusage 20.0.48. Estimates may differ from current API rates.".into());
    Ok(Snapshot {
        settings_fingerprint: fingerprint(p),
        scanned_at: metadata::now(),
        engine_version: version,
        timezone: p.timezone.clone(),
        cost_mode: p.cost_mode.clone(),
        sessions,
        daily,
        sources,
        warnings,
    })
}
