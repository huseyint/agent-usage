mod core;
mod ipc;
#[cfg(any(target_os = "macos", test))]
mod outside_click;
mod tray;
mod tray_icon;
#[cfg(not(target_os = "windows"))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
mod traffic_lights;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["tray"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );
    #[cfg(not(target_os = "windows"))]
    let builder = builder.menu(|app| {
        let menu = Menu::default(app)?;
        let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
        if let Some(app_menu) = menu
            .items()?
            .first()
            .and_then(|item| item.as_submenu().cloned())
        {
            app_menu.insert(&settings, 1)?;
        }
        let sidebar = MenuItem::with_id(
            app,
            "toggle-sidebar",
            "Toggle Sidebar",
            true,
            Some("CmdOrCtrl+Backslash"),
        )?;
        let workspace = MenuItem::with_id(app, "workspace", "Go to Workspace", true, None::<&str>)?;
        let recent = MenuItem::with_id(app, "tray-recent", "Recent Sessions", true, None::<&str>)?;
        let existing_view = menu
            .items()?
            .into_iter()
            .filter_map(|item| item.as_submenu().cloned())
            .find(|submenu| submenu.text().is_ok_and(|text| text == "View"));
        if let Some(view) = existing_view {
            view.append_items(&[
                &PredefinedMenuItem::separator(app)?,
                &sidebar,
                &workspace,
                &recent,
            ])?;
        } else {
            let view = Submenu::with_items(app, "View", true, &[&sidebar, &workspace, &recent])?;
            menu.insert(&view, 2)?;
        }
        let whats_new = MenuItem::with_id(
            app,
            "whats-new",
            "What’s New in AI Coding Usage",
            true,
            None::<&str>,
        )?;
        let existing_help = menu
            .items()?
            .into_iter()
            .filter_map(|item| item.as_submenu().cloned())
            .find(|submenu| submenu.text().is_ok_and(|text| text == "Help"));
        if let Some(help) = existing_help {
            help.append(&whats_new)?;
        } else {
            menu.append(&Submenu::with_items(app, "Help", true, &[&whats_new])?)?;
        }
        Ok(menu)
    });
    let app = builder
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if action == "tray-recent" {
                tray::toggle_from_tray(app);
                return;
            }
            if matches!(
                action,
                "settings" | "toggle-sidebar" | "workspace" | "whats-new"
            ) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("menu-action", action);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            tray::open_dashboard,
            tray::dismiss_tray,
            tray::quit_from_tray,
            ipc::get_bootstrap_status,
            ipc::get_view,
            ipc::get_session_detail,
            ipc::check_sessions,
            ipc::get_session_activity,
            ipc::get_project_icons,
            ipc::update_session_metadata,
            ipc::set_project_alias,
            ipc::set_preferences,
            ipc::test_engine,
            ipc::refresh_usage,
            ipc::clear_cache,
            ipc::open_local_target,
            ipc::get_diagnostics,
            ipc::export_report,
            ipc::save_report,
            ipc::choose_local_path,
            ipc::cancel_refresh
        ])
        .setup(|app| {
            let default_dir = app.path().app_data_dir()?;
            let dir = if cfg!(debug_assertions) {
                std::env::var_os("AGENT_USAGE_TEST_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .filter(|p| p.is_absolute())
                    .unwrap_or(default_dir)
            } else {
                default_dir
            };
            let conn = core::storage::open(&dir).map_err(|e| e.message)?;
            let prefs = core::storage::preferences(&conn).map_err(|e| e.message)?;
            app.manage(ipc::AppState {
                dir,
                scanning: Default::default(),
                cancelled: Default::default(),
                dirty: Default::default(),
                last_error: std::sync::Mutex::new(
                    core::storage::last_failure(&conn).unwrap_or(None),
                ),
                tray_available: Default::default(),
                watcher: Default::default(),
                activity: Default::default(),
            });
            ipc::watch(app.handle(), &prefs);
            // WebView2 can invoke commands while a window is being created, so
            // register AppState before loading either frontend.
            for config in &app.config().app.windows {
                let window = tauri::WebviewWindowBuilder::from_config(app.handle(), config)?;
                #[cfg(target_os = "windows")]
                let window = if config.label == "main" {
                    window.decorations(false).shadow(true)
                } else {
                    window
                };
                window.build()?;
            }
            tray::init(app.handle());
            #[cfg(target_os = "macos")]
            outside_click::install(app.handle());
            ipc::schedule(app.handle().clone());
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                traffic_lights::install(&window.as_ref().window());
            }
            Ok(())
        })
        .on_page_load(|_webview, _payload| {
            #[cfg(target_os = "macos")]
            if _webview.label() == "main" {
                traffic_lights::install(&_webview.window());
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "tray" {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }
            #[cfg(target_os = "macos")]
            match event {
                tauri::WindowEvent::ThemeChanged(_) => traffic_lights::install(window),
                tauri::WindowEvent::Destroyed => traffic_lights::uninstall(window),
                _ => {}
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<ipc::AppState>();
                if let Ok(conn) = core::storage::open(&state.dir) {
                    if let Ok(p) = core::storage::preferences(&conn) {
                        if p.close_to_tray
                            && p.tray_enabled
                            && state
                                .tray_available
                                .load(std::sync::atomic::Ordering::Relaxed)
                            && window.hide().is_ok()
                        {
                            api.prevent_close();
                        }
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build AI Coding Usage");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if matches!(_event, tauri::RunEvent::Exit) {
            outside_click::uninstall();
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            if let Some(window) = _app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}
