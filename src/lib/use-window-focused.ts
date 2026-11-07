import { useEffect, useState } from "react";
import { isDesktop } from "./desktop";

export function useWindowFocused() {
  const [focused, setFocused] = useState(!isDesktop && document.hasFocus());
  useEffect(() => {
    let disposed = false;
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    const native = isDesktop
      ? import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
          const window = getCurrentWindow();
          const unlisten = await window.onFocusChanged(({ payload }) => {
            if (!disposed) setFocused(payload);
          });
          const visible = await window.isVisible();
          const active = await window.isFocused();
          if (!disposed) setFocused(visible && active);
          return unlisten;
        })
      : Promise.resolve(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      void native.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return focused;
}
