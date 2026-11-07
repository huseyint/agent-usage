import { useEffect, useState } from "react";
import { isDesktop } from "./desktop";

// A side-monitor window stays live even when another app has keyboard focus.
export function useWindowVisible() {
  const [visible, setVisible] = useState(
    !isDesktop && document.visibilityState === "visible",
  );
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const browserVisibility = () =>
      setVisible(document.visibilityState === "visible");
    if (!isDesktop)
      document.addEventListener("visibilitychange", browserVisibility);
    const native = isDesktop
      ? import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
          const window = getCurrentWindow();
          const update = async () => {
            const [shown, minimized] = await Promise.all([
              window.isVisible(),
              window.isMinimized(),
            ]);
            if (!disposed) setVisible(shown && !minimized);
          };
          const unlisten = await window.onFocusChanged(() => {
            void update().catch(() => {});
          });
          await update();
          if (!disposed)
            timer = globalThis.window.setInterval(() => {
              void update().catch(() => {});
            }, 2000);
          return unlisten;
        })
      : Promise.resolve(() => {});
    return () => {
      disposed = true;
      if (timer !== undefined) globalThis.window.clearInterval(timer);
      document.removeEventListener("visibilitychange", browserVisibility);
      void native.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return visible;
}
