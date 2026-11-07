use crate::{
    core::{metadata, reports, storage, types::Query},
    ipc::AppState,
};
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, PhysicalSize, Rect,
};
#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DashboardTarget {
    page: String,
    session_key: Option<String>,
}

#[tauri::command]
pub fn dismiss_tray(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn quit_from_tray(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle, target: DashboardTarget) -> Result<(), String> {
    if !matches!(target.page.as_str(), "overview" | "sessions" | "settings") {
        return Err("Unknown dashboard page".into());
    }
    let window = app
        .get_webview_window("main")
        .ok_or("Dashboard unavailable")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window
        .emit("tray-navigate", target)
        .map_err(|e| e.to_string())?;
    dismiss_tray(app);
    Ok(())
}

fn show(app: &tauri::AppHandle) {
    let _ = open_dashboard(
        app.clone(),
        DashboardTarget {
            page: "overview".into(),
            session_key: None,
        },
    );
}

fn popover_bounds(
    anchor: (f64, f64, f64, f64),
    area: (f64, f64, f64, f64),
) -> (f64, f64, f64, f64) {
    let (left, top, width, height) = area;
    let panel_width = 420.0_f64.min(width - 16.0);
    let panel_height = 650.0_f64.min(height - 16.0);
    let x = (anchor.0 + anchor.2 / 2.0 - panel_width / 2.0)
        .clamp(left + 8.0, left + width - panel_width - 8.0);
    let below = anchor.1 + anchor.3 + 6.0;
    let y = if below + panel_height <= top + height - 8.0 {
        below
    } else {
        anchor.1 - panel_height - 6.0
    }
    .clamp(top + 8.0, top + height - panel_height - 8.0);
    (x, y, panel_width, panel_height)
}

type Bounds = (f64, f64, f64, f64);

#[cfg(any(target_os = "macos", test))]
fn contains_point(rect: Bounds, point: (f64, f64)) -> bool {
    point.0 >= rect.0 && point.0 < rect.0 + rect.2 && point.1 >= rect.1 && point.1 < rect.1 + rect.3
}

// All macOS inputs and the result are global AppKit points (bottom-left origin).
// Do not mix them with tray-icon's physical coordinates or a window's old DPI.
#[cfg(any(target_os = "macos", test))]
fn macos_popover_bounds(
    cursor: (f64, f64),
    screens: &[(Bounds, Bounds)],
    tray: Option<Bounds>,
) -> Option<Bounds> {
    let (screen, visible) = screens
        .iter()
        .find(|(frame, _)| contains_point(*frame, cursor))?;
    // macOS can mirror the menu bar onto a display other than the status item's
    // reported window. In that case anchor below the click on the actual screen.
    let anchor = tray
        .filter(|rect| contains_point(*rect, cursor))
        .unwrap_or((cursor.0 - 12.0, screen.1 + screen.3 - 24.0, 24.0, 24.0));
    let top_down = |r: Bounds| (r.0, -r.1 - r.3, r.2, r.3);
    let (x, y, width, height) = popover_bounds(top_down(anchor), top_down(*visible));
    Some((x, -y - height, width, height))
}

#[cfg(target_os = "macos")]
fn position_macos_popover(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let Some(tray) = app.tray_by_id("usage") else {
        return false;
    };
    let window = window.clone();
    tray.with_inner_tray_icon(move |tray| {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        let cursor = NSEvent::mouseLocation();
        let bounds = |rect: NSRect| {
            (
                rect.origin.x,
                rect.origin.y,
                rect.size.width,
                rect.size.height,
            )
        };
        let screens: Vec<_> = NSScreen::screens(mtm)
            .iter()
            .map(|screen| (bounds(screen.frame()), bounds(screen.visibleFrame())))
            .collect();
        let anchor = tray
            .ns_status_item()
            .and_then(|item| item.button(mtm))
            .and_then(|button| button.window())
            .map(|window| bounds(window.frame()));
        let Some((x, y, width, height)) =
            macos_popover_bounds((cursor.x, cursor.y), &screens, anchor)
        else {
            return false;
        };
        let Ok(ptr) = window.ns_window() else {
            return false;
        };
        // The handle belongs to this live webview window; the closure runs on
        // AppKit's main thread. Native placement avoids Tao's DPI conversion.
        unsafe {
            (&*(ptr as *const NSWindow)).setFrame_display(
                NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
                true,
            );
        }
        true
    })
    .unwrap_or(false)
}

fn portable_popover_bounds(
    anchor: Bounds,
    area: Bounds,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let logical = |r: Bounds| (r.0 / scale, r.1 / scale, r.2 / scale, r.3 / scale);
    let (x, y, width, height) = popover_bounds(logical(anchor), logical(area));
    (
        PhysicalPosition::new((x * scale).round() as i32, (y * scale).round() as i32),
        PhysicalSize::new(
            (width * scale).round() as u32,
            (height * scale).round() as u32,
        ),
    )
}

fn position_portable_popover(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    rect: Rect,
    point: PhysicalPosition<f64>,
) {
    let monitor = app
        .monitor_from_point(point.x, point.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let anchor = rect.position.to_physical::<f64>(scale);
        let anchor_size = rect.size.to_physical::<f64>(scale);
        let (position, size) = portable_popover_bounds(
            (anchor.x, anchor.y, anchor_size.width, anchor_size.height),
            (
                area.position.x as f64,
                area.position.y as f64,
                area.size.width as f64,
                area.size.height as f64,
            ),
            scale,
        );
        // Use the destination display's pixels, not the hidden window's old DPI.
        let _ = window.set_position(position);
        let _ = window.set_size(size);
    }
}

fn toggle_popover(app: &tauri::AppHandle, rect: Rect, point: PhysicalPosition<f64>) {
    let Some(window) = app.get_webview_window("tray") else {
        show(app);
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    #[cfg(target_os = "macos")]
    let positioned = position_macos_popover(app, &window);
    #[cfg(not(target_os = "macos"))]
    let positioned = false;
    if !positioned {
        position_portable_popover(app, &window, rect, point);
    }
    #[cfg(target_os = "macos")]
    crate::outside_click::opened();
    if window.show().is_ok() {
        let _ = window.set_focus();
        let _ = window.emit("tray-opened", ());
    }
}

pub fn toggle_from_tray(app: &tauri::AppHandle) {
    let point = app.cursor_position().unwrap_or_default();
    let rect = app
        .tray_by_id("usage")
        .and_then(|tray| tray.rect().ok().flatten())
        .unwrap_or(Rect {
            position: point.into(),
            size: tauri::PhysicalSize::new(1, 1).into(),
        });
    toggle_popover(app, rect, point);
}

#[cfg(target_os = "macos")]
fn round_popover(window: &tauri::WebviewWindow) {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_app_kit::NSWindow;
    // Native clipping keeps the borderless panel rounded without enabling private webview APIs.
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            let native = &*(ptr as *const NSWindow);
            let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
            let _: () = msg_send![native, setOpaque: false];
            let _: () = msg_send![native, setBackgroundColor: clear];
            if let Some(view) = native.contentView() {
                let _: () = msg_send![&view, setWantsLayer: true];
                let layer: *mut AnyObject = msg_send![&view, layer];
                if !layer.is_null() {
                    let _: () = msg_send![layer, setCornerRadius: 12.0_f64];
                    let _: () = msg_send![layer, setMasksToBounds: true];
                }
            }
        }
    }
}

pub fn init(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window("tray") {
        round_popover(&window);
    }
    let builder = TrayIconBuilder::with_id("usage")
        .icon(crate::tray_icon::image(false))
        .icon_as_template(true)
        .tooltip("AI Coding Usage — not yet scanned")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show(app),
            "recent" => toggle_from_tray(app),
            "refresh" => {
                let h = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = crate::ipc::refresh(&h);
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                rect,
                position,
                ..
            } = event
            {
                #[cfg(target_os = "macos")]
                if crate::outside_click::take_tray_release() {
                    return;
                }
                toggle_popover(tray.app_handle(), rect, position);
            }
        });
    if builder.build(app).is_ok() {
        app.state::<AppState>()
            .tray_available
            .store(true, Ordering::Relaxed);
        sync(app);
    }
}
pub fn day_changed(previous: &mut Option<(String, String)>, now: &str, timezone: &str) -> bool {
    let Some(day) = metadata::local_day(now, timezone) else {
        return false;
    };
    let current = (timezone.to_owned(), day);
    if previous.as_ref() == Some(&current) {
        return false;
    }
    *previous = Some(current);
    true
}

pub fn sync(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("usage") else {
        return;
    };
    let state = app.state::<AppState>();
    let Ok(conn) = storage::open(&state.dir) else {
        return;
    };
    let Ok(p) = storage::preferences(&conn) else {
        return;
    };
    let _ = tray.set_visible(p.tray_enabled);
    if !p.tray_enabled {
        dismiss_tray(app.clone());
    }
    let mut stale = state.last_error.lock().unwrap().is_some();
    let today = metadata::local_day(&metadata::now(), &p.timezone).unwrap_or_default();
    let snapshot = storage::snapshot(&conn).ok().flatten();
    let unread = storage::checked_session_keys(&conn)
        .ok()
        .map(|checked| {
            snapshot
                .as_ref()
                .map(|s| {
                    s.sessions
                        .iter()
                        .filter(|s| !checked.contains(&s.key))
                        .count()
                })
                .unwrap_or(0)
        })
        .unwrap_or(0);
    let _ = tray.set_icon_with_as_template(Some(crate::tray_icon::image(unread > 0)), true);
    let mut claude = None;
    let mut codex = None;
    let mut at = "Not yet scanned".to_string();
    let mut partial = false;
    if let Some(s) = snapshot {
        stale |= s.settings_fingerprint != crate::core::engine::fingerprint(&p);
        let query = Query {
            since: Some(today.clone()),
            until: Some(today),
            ..Query::default()
        };
        if let Ok(v) = reports::build(s, &query, &Default::default(), &Default::default(), stale) {
            partial = v.summary.missing_pricing;
            claude = Some(
                v.daily
                    .iter()
                    .filter(|d| d.provider == "claude")
                    .map(|d| d.cost_micros)
                    .sum::<i64>(),
            );
            codex = Some(
                v.daily
                    .iter()
                    .filter(|d| d.provider == "codex")
                    .map(|d| d.cost_micros)
                    .sum::<i64>(),
            );
            at = format!(
                "Verified {}",
                chrono::DateTime::parse_from_rfc3339(&v.scanned_at)
                    .ok()
                    .map(|d| if p.timezone == "local" {
                        d.with_timezone(&chrono::Local).format("%H:%M").to_string()
                    } else {
                        p.timezone
                            .parse::<chrono_tz::Tz>()
                            .map(|tz| d.with_timezone(&tz).format("%H:%M").to_string())
                            .unwrap_or_default()
                    })
                    .unwrap_or_else(|| "—".into())
            );
        }
    }
    let fmt = |v: Option<i64>| {
        v.map(|v| format!("${:.2}", v as f64 / 1e6))
            .unwrap_or_else(|| "Unavailable".into())
    };
    let total = claude.zip(codex).map(|(c, x)| c + x);
    let warning = if stale {
        " • Stale"
    } else if partial {
        " • Partial pricing"
    } else {
        ""
    };
    let title = format!("Today (Est. API value): {}{warning}", fmt(total));
    let tooltip = if unread > 0 {
        format!(
            "{unread} new session{} • {title}",
            if unread == 1 { "" } else { "s" }
        )
    } else {
        title.clone()
    };
    let tooltip = format!("{tooltip}\nUsage recorded today. Copied session history is counted once. Estimated API value, not subscription charges.");
    let _ = tray.set_tooltip(Some(&tooltip));
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(if p.tray_title {
        Some(format!("{}{warning}", fmt(total)))
    } else {
        None
    });
    let result = (|| -> tauri::Result<()> {
        let menu = Menu::with_items(
            app,
            &[
                &MenuItem::new(app, &title, false, None::<&str>)?,
                &MenuItem::new(app, format!("Claude: {}", fmt(claude)), false, None::<&str>)?,
                &MenuItem::new(app, format!("Codex: {}", fmt(codex)), false, None::<&str>)?,
                &MenuItem::new(app, format!("{at}{warning}"), false, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "recent", "Recent Sessions…", true, None::<&str>)?,
                &MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?,
                &MenuItem::with_id(app, "refresh", "Refresh Now", true, None::<&str>)?,
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ],
        )?;
        tray.set_menu(Some(menu))?;
        Ok(())
    })();
    let _ = result;
}

#[cfg(test)]
mod tests {
    use super::{day_changed, macos_popover_bounds, popover_bounds, portable_popover_bounds};

    #[test]
    fn portable_placement_uses_target_display_pixels_across_dpi_changes() {
        let (position, size) = portable_popover_bounds(
            (3360.0, 0.0, 48.0, 48.0),
            (2880.0, 48.0, 3840.0, 2112.0),
            2.0,
        );
        assert_eq!(
            (position.x, position.y, size.width, size.height),
            (2964, 64, 840, 1300)
        );
        let (position, size) = portable_popover_bounds(
            (4400.0, 0.0, 24.0, 24.0),
            (3024.0, 24.0, 1920.0, 1056.0),
            1.0,
        );
        assert_eq!(
            (position.x, position.y, size.width, size.height),
            (4202, 32, 420, 650)
        );
    }

    #[test]
    fn macos_click_on_second_display_ignores_primary_tray_rectangle() {
        let screens = [
            ((0.0, 0.0, 1512.0, 982.0), (0.0, 25.0, 1512.0, 932.0)),
            (
                (1512.0, 0.0, 1920.0, 1080.0),
                (1512.0, 25.0, 1920.0, 1031.0),
            ),
        ];
        let bounds = macos_popover_bounds(
            (3300.0, 1068.0),
            &screens,
            Some((1300.0, 958.0, 24.0, 24.0)),
        )
        .unwrap();
        assert_eq!(bounds, (3004.0, 398.0, 420.0, 650.0));
    }

    #[test]
    fn macos_supports_displays_left_and_above_the_primary_without_pixel_scaling() {
        let screens = [
            ((0.0, 0.0, 1512.0, 982.0), (0.0, 25.0, 1512.0, 932.0)),
            (
                (-1920.0, 0.0, 1920.0, 1080.0),
                (-1920.0, 25.0, 1920.0, 1031.0),
            ),
            ((0.0, 982.0, 2560.0, 1440.0), (0.0, 1007.0, 2560.0, 1391.0)),
        ];
        let left = macos_popover_bounds((-100.0, 1068.0), &screens, None).unwrap();
        assert_eq!(left, (-428.0, 398.0, 420.0, 650.0));
        let above = macos_popover_bounds((2400.0, 2410.0), &screens, None).unwrap();
        assert_eq!(above, (2132.0, 1740.0, 420.0, 650.0));
    }

    #[test]
    fn macos_uses_icon_bounds_when_they_contain_the_actual_click() {
        let screens = [((0.0, 0.0, 1512.0, 982.0), (0.0, 25.0, 1512.0, 932.0))];
        let bounds =
            macos_popover_bounds((1015.0, 970.0), &screens, Some((1000.0, 958.0, 24.0, 24.0)))
                .unwrap();
        assert_eq!(bounds, (802.0, 299.0, 420.0, 650.0));
        assert!(macos_popover_bounds((2000.0, 0.0), &screens, None).is_none());
    }

    #[test]
    fn calendar_rollover_is_independent_of_scanning_and_handles_weekend_resume() {
        let mut day = None;
        assert!(day_changed(
            &mut day,
            "2026-11-07T05:59:59Z",
            "America/Chicago"
        ));
        assert!(!day_changed(
            &mut day,
            "2026-11-07T05:59:59.999Z",
            "America/Chicago"
        ));
        assert!(day_changed(
            &mut day,
            "2026-11-07T06:00:00Z",
            "America/Chicago"
        ));
        assert!(day_changed(
            &mut day,
            "2026-11-09T15:00:00Z",
            "America/Chicago"
        ));
        assert!(!day_changed(
            &mut day,
            "2026-11-09T15:01:00Z",
            "America/Chicago"
        ));
        assert!(day_changed(&mut day, "2026-11-09T15:01:00Z", "UTC"));
    }

    #[test]
    fn repeated_dst_hour_does_not_roll_over_the_day() {
        let mut day = None;
        assert!(day_changed(
            &mut day,
            "2026-11-01T06:30:00Z",
            "America/Chicago"
        ));
        assert!(!day_changed(
            &mut day,
            "2026-11-01T07:30:00Z",
            "America/Chicago"
        ));
        assert!(day_changed(
            &mut day,
            "2026-11-02T06:00:00Z",
            "America/Chicago"
        ));
    }

    #[test]
    fn top_menu_bar_panel_is_centered_below_icon() {
        assert_eq!(
            popover_bounds((700.0, 0.0, 24.0, 24.0), (0.0, 24.0, 1440.0, 876.0)),
            (502.0, 32.0, 420.0, 650.0)
        );
    }

    #[test]
    fn bottom_tray_panel_opens_above_taskbar_and_stays_on_screen() {
        assert_eq!(
            popover_bounds((1410.0, 860.0, 24.0, 40.0), (0.0, 0.0, 1440.0, 860.0)),
            (1012.0, 202.0, 420.0, 650.0)
        );
    }

    #[test]
    fn negative_monitor_origin_and_small_displays_are_supported() {
        let bounds = popover_bounds((-1280.0, 0.0, 24.0, 24.0), (-1280.0, 24.0, 1280.0, 776.0));
        assert_eq!(bounds, (-1272.0, 32.0, 420.0, 650.0));
        assert_eq!(
            popover_bounds((340.0, 460.0, 20.0, 20.0), (0.0, 0.0, 360.0, 480.0)),
            (8.0, 8.0, 344.0, 464.0)
        );
    }
}
