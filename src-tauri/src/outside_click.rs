#[derive(Default)]
struct ClickDismissal {
    suppress_tray_release: bool,
    opened_at: f64,
}
impl ClickDismissal {
    fn opened(&mut self, at: f64) {
        self.opened_at = at;
        self.suppress_tray_release = false;
    }
    fn accepts(&self, event_at: f64) -> bool {
        event_at > self.opened_at
    }
    fn begin_local_click(&mut self) {
        self.suppress_tray_release = false;
    }
    fn dismiss_status_click(&mut self) {
        self.suppress_tray_release = true;
    }
    fn take_tray_release(&mut self) -> bool {
        std::mem::take(&mut self.suppress_tray_release)
    }
}

fn outside(visible: bool, frame: (f64, f64, f64, f64), point: (f64, f64)) -> bool {
    visible
        && !(point.0 >= frame.0
            && point.0 < frame.0 + frame.2
            && point.1 >= frame.1
            && point.1 < frame.1 + frame.3)
}

#[cfg(target_os = "macos")]
mod native {
    use super::{outside, ClickDismissal};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSEvent, NSEventMask, NSStatusWindowLevel, NSWindow};
    use objc2_foundation::NSProcessInfo;
    use std::{cell::RefCell, ptr::NonNull};
    use tauri::Manager;

    struct Monitors {
        global: Option<Retained<AnyObject>>,
        local: Option<Retained<AnyObject>>,
    }
    thread_local! {
        static MONITORS: RefCell<Option<Monitors>> = const { RefCell::new(None) };
        static CLICKS: RefCell<ClickDismissal> = RefCell::new(ClickDismissal::default());
    }

    fn mouse_down(app: &tauri::AppHandle, event: NonNull<NSEvent>, local: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let event = unsafe { event.as_ref() };
        if !CLICKS.with(|state| state.borrow().accepts(event.timestamp())) {
            return;
        }
        if local {
            CLICKS.with(|state| state.borrow_mut().begin_local_click());
        }
        let Some(window) = app.get_webview_window("tray") else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        // The event callback and live NSWindow handle are on AppKit's main thread.
        let native = unsafe { &*(ptr as *const NSWindow) };
        if !native.isVisible() {
            return;
        }
        let frame = native.frame();
        let clicked_window = if local { event.window(mtm) } else { None };
        let point = clicked_window
            .as_ref()
            .map(|window| window.convertPointToScreen(event.locationInWindow()))
            .unwrap_or_else(NSEvent::mouseLocation);
        if !outside(
            true,
            (
                frame.origin.x,
                frame.origin.y,
                frame.size.width,
                frame.size.height,
            ),
            (point.x, point.y),
        ) {
            return;
        }
        if local {
            // A tray click closes on mouse-down. Its mouse-up must not reopen it.
            // Use the public window level, including mirrored secondary menu bars.
            if clicked_window.is_some_and(|window| window.level() == NSStatusWindowLevel) {
                CLICKS.with(|state| state.borrow_mut().dismiss_status_click());
            }
        }
        let _ = window.hide();
    }

    pub fn install(app: &tauri::AppHandle) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        uninstall();
        let mask =
            NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown;
        let global_app = app.clone();
        let global_handler =
            RcBlock::new(move |event: NonNull<NSEvent>| mouse_down(&global_app, event, false));
        let global = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_handler);
        let local_app = app.clone();
        let local_handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            mouse_down(&local_app, event, true);
            event.as_ptr()
        });
        // Returning the original valid event preserves normal dispatch and click-through.
        let local =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_handler) };
        MONITORS.with(|slot| *slot.borrow_mut() = Some(Monitors { global, local }));
    }

    pub fn uninstall() {
        let monitors = MONITORS.with(|slot| slot.borrow_mut().take());
        if let Some(monitors) = monitors {
            // These tokens were returned by NSEvent's monitor registration APIs.
            unsafe {
                if let Some(token) = monitors.global {
                    NSEvent::removeMonitor(&token);
                }
                if let Some(token) = monitors.local {
                    NSEvent::removeMonitor(&token);
                }
            }
        }
        CLICKS.with(|state| *state.borrow_mut() = ClickDismissal::default());
    }

    pub fn opened() {
        CLICKS.with(|state| {
            state
                .borrow_mut()
                .opened(NSProcessInfo::processInfo().systemUptime())
        });
    }

    pub fn take_tray_release() -> bool {
        CLICKS.with(|state| state.borrow_mut().take_tray_release())
    }
}
#[cfg(target_os = "macos")]
pub use native::{install, opened, take_tray_release, uninstall};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_opening_click_cannot_immediately_dismiss_the_panel() {
        let mut clicks = ClickDismissal::default();
        clicks.opened(20.0);
        assert!(!clicks.accepts(19.9));
        assert!(!clicks.accepts(20.0));
        assert!(clicks.accepts(20.001));
    }
    #[test]
    fn outside_clicks_include_desktop_and_other_displays_but_not_popover_controls() {
        let frame = (1500.0, 200.0, 420.0, 650.0);
        assert!(!outside(true, frame, (1600.0, 400.0)));
        for point in [
            (1499.0, 400.0),
            (1920.0, 400.0),
            (1600.0, 199.0),
            (1600.0, 850.0),
            (-1000.0, 500.0),
        ] {
            assert!(outside(true, frame, point));
        }
        assert!(!outside(false, frame, (-1000.0, 500.0)));
    }
    #[test]
    fn tray_click_dismisses_once_and_a_later_click_can_reopen() {
        let mut clicks = ClickDismissal::default();
        clicks.begin_local_click();
        clicks.dismiss_status_click();
        assert!(clicks.take_tray_release());
        assert!(!clicks.take_tray_release());
        clicks.begin_local_click();
        assert!(!clicks.take_tray_release());
    }
    #[test]
    fn cancelled_or_dragged_tray_click_cannot_suppress_a_new_click() {
        let mut clicks = ClickDismissal::default();
        clicks.dismiss_status_click();
        clicks.begin_local_click();
        assert!(!clicks.take_tray_release());
    }
}
