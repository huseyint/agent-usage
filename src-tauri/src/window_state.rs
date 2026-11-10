use tauri::{
    plugin::{Builder, TauriPlugin},
    RunEvent, WindowEvent,
};
#[cfg(not(target_os = "macos"))]
use tauri::{PhysicalPosition, PhysicalSize, Window};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_window_state::WindowExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub const FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Bounds {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl Bounds {
    fn intersection_area(self, other: Self) -> i64 {
        let width = (self.x + self.width).min(other.x + other.width) - self.x.max(other.x);
        let height = (self.y + self.height).min(other.y + other.height) - self.y.max(other.y);
        width.max(0) * height.max(0)
    }
}

// Keep a valid secondary-display placement, including negative coordinates.
// Prefer the largest overlap for spanning windows; use the primary display if
// the saved display disappeared. Inputs must share a coordinate system: desktop
// pixels on Windows/Linux or global AppKit points on macOS.
fn fit_to_displays(saved: Bounds, areas: &[Bounds], primary: usize) -> Option<(usize, Bounds)> {
    let (mut index, overlap) = areas
        .iter()
        .enumerate()
        .filter(|(_, area)| area.width > 0 && area.height > 0)
        .map(|(i, area)| (i, saved.intersection_area(*area)))
        .max_by_key(|(_, overlap)| *overlap)?;
    if overlap == 0
        && areas
            .get(primary)
            .is_some_and(|a| a.width > 0 && a.height > 0)
    {
        index = primary;
    }
    let area = areas[index];
    let width = saved.width.clamp(1, area.width);
    let height = saved.height.clamp(1, area.height);
    let (x, y) = if overlap == 0 {
        (
            area.x + (area.width - width) / 2,
            area.y + (area.height - height) / 2,
        )
    } else {
        (
            saved.x.clamp(area.x, area.x + area.width - width),
            saved.y.clamp(area.y, area.y + area.height - height),
        )
    };
    Some((
        index,
        Bounds {
            x,
            y,
            width,
            height,
        },
    ))
}

#[cfg(not(target_os = "macos"))]
fn restore(window: &Window) -> tauri::Result<()> {
    // Restore normal bounds first so maximized windows also have usable bounds
    // when the user restores them. Visibility is deliberately never persisted.
    window.restore_state(StateFlags::SIZE | StateFlags::POSITION)?;
    let monitors = window.available_monitors()?;
    let primary = window.primary_monitor()?;
    let primary = monitors
        .iter()
        .position(|m| {
            primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size())
        })
        .unwrap_or(0);
    let areas: Vec<_> = monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Bounds {
                x: area.position.x.into(),
                y: area.position.y.into(),
                width: area.size.width.into(),
                height: area.size.height.into(),
            }
        })
        .collect();
    let position = window.outer_position()?;
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let saved = Bounds {
        x: position.x.into(),
        y: position.y.into(),
        width: outer.width.into(),
        height: outer.height.into(),
    };
    if let Some((index, _)) = fit_to_displays(saved, &areas, primary) {
        let area = areas[index];
        let scale = monitors[index].scale_factor();
        let border_width = outer.width.saturating_sub(inner.width) as i64;
        let border_height = outer.height.saturating_sub(inner.height) as i64;
        // A small work area must take precedence over the usual layout minimum.
        let minimum = PhysicalSize::new(
            (900.0 * scale)
                .round()
                .min((area.width - border_width).max(1) as f64) as u32,
            (650.0 * scale)
                .round()
                .min((area.height - border_height).max(1) as f64) as u32,
        );
        // A saved size from a lower-DPI display can be below the destination's
        // minimum. Account for that expansion before clamping the position.
        let sized = Bounds {
            width: saved.width.max(i64::from(minimum.width) + border_width),
            height: saved.height.max(i64::from(minimum.height) + border_height),
            ..saved
        };
        let (_, bounds) = fit_to_displays(sized, &[area], 0).expect("valid destination work area");
        // Position first so native sizing uses the destination display's DPI.
        window.set_position(PhysicalPosition::new(bounds.x as i32, bounds.y as i32))?;
        window.set_min_size(Some(minimum))?;
        window.set_size(PhysicalSize::new(
            (bounds.width - border_width).max(1) as u32,
            (bounds.height - border_height).max(1) as u32,
        ))?;
    }
    window.restore_state(StateFlags::MAXIMIZED)
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("dashboard-window-state")
        .setup(|_app, _api| {
            #[cfg(target_os = "macos")]
            native::init(_app);
            Ok(())
        })
        .on_window_ready(|window| {
            if window.label() != "main" {
                return;
            }
            #[cfg(target_os = "macos")]
            let restored = native::restore(&window);
            #[cfg(not(target_os = "macos"))]
            let restored = restore(&window);
            if let Err(error) = restored {
                eprintln!("Could not restore dashboard placement: {error}");
            }
            // Even a corrupt state file or unavailable monitor API must not
            // prevent the user from opening the dashboard.
            let _ = window.show();
            let _ = window.set_focus();
        })
        .on_event(|app, event| {
            #[cfg(target_os = "macos")]
            native::on_event(app, event);
            if matches!(event, RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { .. } | WindowEvent::Focused(false), .. } if label == "main") {
                // Close-to-tray keeps the process alive; flush before the next
                // launch even if it is later terminated without a clean exit.
                if let Err(error) = app.save_window_state(FLAGS) {
                    eprintln!("Could not save dashboard placement: {error}");
                }
            }
        })
        .build()
}

// Tao multiplies macOS global coordinates by each window/monitor's own scale.
// Those physical rectangles cannot be compared across mixed-DPI displays. Keep
// normal frames in AppKit points instead and let AppKit handle display changes.
#[cfg(target_os = "macos")]
mod native {
    use super::{fit_to_displays, Bounds};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};
    use tauri_plugin_window_state::{StateFlags, WindowExt};

    const FILENAME: &str = ".dashboard-frame.json";
    struct NormalFrame(Mutex<Option<Bounds>>);

    fn bounds(rect: NSRect) -> Bounds {
        Bounds {
            x: rect.origin.x.round() as i64,
            y: (-rect.origin.y - rect.size.height).round() as i64,
            width: rect.size.width.round() as i64,
            height: rect.size.height.round() as i64,
        }
    }

    fn decode_frame(data: &[u8]) -> Option<Bounds> {
        serde_json::from_slice::<Bounds>(data).ok().filter(|b| {
            i32::try_from(b.x).is_ok()
                && i32::try_from(b.y).is_ok()
                && b.width > 0
                && b.height > 0
                && u32::try_from(b.width).is_ok()
                && u32::try_from(b.height).is_ok()
        })
    }

    pub fn init(app: &AppHandle) {
        let frame = app
            .path()
            .app_config_dir()
            .ok()
            .and_then(|dir| std::fs::read(dir.join(FILENAME)).ok())
            .and_then(|data| decode_frame(&data));
        app.manage(NormalFrame(Mutex::new(frame)));
    }

    pub fn restore(window: &Window) -> tauri::Result<()> {
        let state = window.state::<NormalFrame>();
        let saved = *state.0.lock().unwrap();
        if saved.is_none() {
            // Migrate existing installations that only have the plugin's file.
            window.restore_state(StateFlags::SIZE | StateFlags::POSITION)?;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return Ok(());
        };
        let ptr = window.ns_window()?;
        // The callback runs on AppKit's main thread and owns a live window.
        let native = unsafe { &*(ptr as *const NSWindow) };
        let frame = native.frame();
        let content = native.contentRectForFrameRect(frame);
        let areas: Vec<_> = NSScreen::screens(mtm)
            .iter()
            .map(|screen| bounds(screen.visibleFrame()))
            .collect();
        if let Some((index, _)) = fit_to_displays(saved.unwrap_or(bounds(frame)), &areas, 0) {
            let area = areas[index];
            let border_width = (frame.size.width - content.size.width).max(0.0).round() as i64;
            let border_height = (frame.size.height - content.size.height).max(0.0).round() as i64;
            let min_width = 900.min((area.width - border_width).max(1));
            let min_height = 650.min((area.height - border_height).max(1));
            let saved = saved.unwrap_or(bounds(frame));
            let sized = Bounds {
                width: saved.width.max(min_width + border_width),
                height: saved.height.max(min_height + border_height),
                ..saved
            };
            let (_, fitted) =
                fit_to_displays(sized, &[area], 0).expect("valid destination work area");
            native.setContentMinSize(NSSize::new(min_width as f64, min_height as f64));
            native.setFrame_display(
                NSRect::new(
                    NSPoint::new(fitted.x as f64, (-fitted.y - fitted.height) as f64),
                    NSSize::new(fitted.width as f64, fitted.height as f64),
                ),
                true,
            );
            *state.0.lock().unwrap() = Some(fitted);
        }
        window.restore_state(StateFlags::MAXIMIZED)
    }

    fn capture(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if window.is_minimized().unwrap_or(true)
            || window.is_maximized().unwrap_or(true)
            || window.is_fullscreen().unwrap_or(true)
            || MainThreadMarker::new().is_none()
        {
            return;
        }
        if let Ok(ptr) = window.ns_window() {
            // The event callback is on the main thread with a live NSWindow.
            let frame = unsafe { (&*(ptr as *const NSWindow)).frame() };
            *app.state::<NormalFrame>().0.lock().unwrap() = Some(bounds(frame));
        }
    }

    fn save(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let Some(frame) = *app.state::<NormalFrame>().0.lock().unwrap() else {
            return Ok(());
        };
        let dir = app.path().app_config_dir()?;
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(FILENAME), serde_json::to_vec(&frame)?)?;
        Ok(())
    }

    pub fn on_event(app: &AppHandle, event: &RunEvent) {
        if matches!(event, RunEvent::WindowEvent { label, event: WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }, .. } if label == "main")
        {
            capture(app);
        }
        if matches!(event, RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { .. } | WindowEvent::Focused(false), .. } if label == "main")
            || matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit)
        {
            capture(app);
            if let Err(error) = save(app) {
                eprintln!("Could not save native dashboard frame: {error}");
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn native_frames_use_global_points_for_displays_left_and_above_primary() {
            let frame = NSRect::new(NSPoint::new(-1800.0, 1100.0), NSSize::new(1400.0, 900.0));
            let saved = bounds(frame);
            let area = bounds(NSRect::new(
                NSPoint::new(-1920.0, 1000.0),
                NSSize::new(1920.0, 1080.0),
            ));
            assert_eq!(saved.x, -1800);
            assert_eq!(saved.y, -2000);
            assert_eq!(fit_to_displays(saved, &[area], 0), Some((0, saved)));
        }

        #[test]
        fn persisted_frames_retain_negative_origins_and_reject_invalid_geometry() {
            let frame = bounds(NSRect::new(
                NSPoint::new(-1800.0, 1100.0),
                NSSize::new(1400.0, 900.0),
            ));
            assert_eq!(
                decode_frame(&serde_json::to_vec(&frame).unwrap()),
                Some(frame)
            );
            for invalid in [
                b"{".as_slice(),
                br#"{"x":0,"y":0,"width":0,"height":900}"#,
                br#"{"x":0,"y":0,"width":1400,"height":-900}"#,
                br#"{"x":9223372036854775807,"y":0,"width":1400,"height":900}"#,
            ] {
                assert_eq!(decode_frame(invalid), None);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fit_to_displays, Bounds};

    fn bounds(x: i64, y: i64, width: i64, height: i64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn keeps_positions_on_displays_right_left_and_above_primary() {
        let areas = [
            bounds(0, 24, 1920, 1016),
            bounds(1920, 48, 3840, 2112),
            bounds(-1920, 24, 1920, 1016),
            bounds(0, -1416, 2560, 1392),
        ];
        for (index, saved) in [
            (0, bounds(100, 100, 1400, 900)),
            (1, bounds(2200, 100, 2800, 1800)),
            (2, bounds(-1800, 100, 1400, 900)),
            (3, bounds(100, -1300, 1400, 900)),
        ] {
            assert_eq!(fit_to_displays(saved, &areas, 0), Some((index, saved)));
        }
    }

    #[test]
    fn disconnected_display_falls_back_to_center_of_primary_work_area() {
        let areas = [bounds(-1920, 24, 1920, 1016), bounds(0, 24, 1920, 1016)];
        assert_eq!(
            fit_to_displays(bounds(4000, 100, 1400, 900), &areas, 1),
            Some((1, bounds(260, 82, 1400, 900)))
        );
    }

    #[test]
    fn clamps_partial_overlap_and_inaccessible_title_bar() {
        let areas = [bounds(0, 48, 1920, 992)];
        assert_eq!(
            fit_to_displays(bounds(1800, -100, 1400, 900), &areas, 0),
            Some((0, bounds(520, 48, 1400, 900)))
        );
    }

    #[test]
    fn spanning_window_uses_display_with_largest_overlap() {
        let areas = [bounds(0, 24, 1920, 1016), bounds(1920, 24, 1920, 1016)];
        assert_eq!(
            fit_to_displays(bounds(1500, 100, 1400, 900), &areas, 0),
            Some((1, bounds(1920, 100, 1400, 900)))
        );
    }

    #[test]
    fn shrinks_oversized_windows_to_smaller_work_area() {
        assert_eq!(
            fit_to_displays(
                bounds(-100, -100, 2800, 1800),
                &[bounds(0, 24, 800, 576)],
                0
            ),
            Some((0, bounds(0, 24, 800, 576)))
        );
        // An enclosing window intersects a monitor even without a corner inside.
        assert_eq!(
            fit_to_displays(
                bounds(-100, -100, 4000, 3000),
                &[bounds(0, 24, 1920, 1016)],
                0
            ),
            Some((0, bounds(0, 24, 1920, 1016)))
        );
    }

    #[test]
    fn tolerates_missing_monitors_and_extreme_saved_coordinates() {
        assert_eq!(fit_to_displays(bounds(0, 0, 1400, 900), &[], 0), None);
        assert_eq!(
            fit_to_displays(
                bounds(
                    i32::MAX.into(),
                    i32::MIN.into(),
                    u32::MAX.into(),
                    u32::MAX.into()
                ),
                &[bounds(0, 24, 1920, 1016)],
                0,
            ),
            Some((0, bounds(0, 24, 1920, 1016)))
        );
    }
}
