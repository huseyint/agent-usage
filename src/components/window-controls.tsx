import { useEffect, useState } from "react";
import { useUsage } from "@/lib/usage-context";
import { errorMessage } from "@/lib/usage-api";
import { UIcon } from "./usage-icon";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const { setNotice } = useUsage();

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const listener = import("@tauri-apps/api/window").then(
      async ({ getCurrentWindow }) => {
        const window = getCurrentWindow();
        const update = async () => {
          const current = ++revision;
          const maximized = await window.isMaximized();
          if (!disposed && current === revision) setMaximized(maximized);
        };
        const unlisten = await window.onResized(
          () => void update().catch(() => {}),
        );
        void update().catch(() => {});
        return unlisten;
      },
    );
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const act = (action: "minimize" | "toggleMaximize" | "close") => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow()[action]())
      .catch((error) => setNotice(errorMessage(error)));
  };
  const maximizeLabel = maximized ? "Restore window" : "Maximize window";

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize window"
        title="Minimize window"
        onClick={() => act("minimize")}
      >
        <UIcon name="window-minimize" size={16} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={() => act("toggleMaximize")}
      >
        <UIcon
          name={maximized ? "window-restore" : "window-maximize"}
          size={16}
        />
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        aria-label="Close window"
        title="Close window"
        onClick={() => act("close")}
      >
        <UIcon name="close" size={16} />
      </button>
    </div>
  );
}
