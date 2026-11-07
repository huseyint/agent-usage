import { useEffect, useLayoutEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router";
import { WhatsNewDialog } from "./components/whats-new-dialog";
import { AppShell } from "./components/app-shell";
import { isDesktop, isWindows, listenForMenu } from "./lib/desktop";
import { applyTheme, usePreferences } from "./lib/preferences";
import { UsageProvider, useUsage } from "./lib/usage-context";
import { Overview, Projects, Models } from "./routes/analytics";
import { Sessions, SessionDrawer } from "./routes/sessions";
import { UsageSettings, Onboarding } from "./routes/usage-settings";
import { TrayPopover } from "./components/tray-popover";
import { listen } from "@tauri-apps/api/event";
import { usageApi, errorMessage } from "./lib/usage-api";
import type { DashboardTarget } from "./lib/tray";
import { UIcon } from "./components/usage-icon";
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  },
});
function Application() {
  const navigate = useNavigate();
  const location = useLocation();
  const u = useUsage();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const { theme, toggleSidebar } = usePreferences();
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const resolved = applyTheme(theme);
      if (isDesktop)
        void import("@tauri-apps/api/window")
          .then(async ({ getCurrentWindow }) => {
            const w = getCurrentWindow();
            await w.setTheme(theme === "system" ? null : theme);
            await w.setBackgroundColor(
              resolved === "dark" ? "#282828" : "#f0f0f0",
            );
          })
          .catch(() => {});
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => {
    const action = (name: string) => {
      if (name === "settings") navigate("/settings");
      if (name === "workspace") navigate("/");
      if (name === "toggle-sidebar") toggleSidebar();
      if (name === "whats-new") setWhatsNewOpen(true);
    };
    const listeners = listenForMenu(action);
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        navigate("/sessions");
        setTimeout(
          () => document.getElementById("session-search")?.focus(),
          50,
        );
      }
      if (!isDesktop || isWindows) {
        const name = (
          { ",": "settings", "\\": "toggle-sidebar" } as Record<string, string>
        )[e.key.toLowerCase()];
        if (name) {
          e.preventDefault();
          action(name);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      void listeners.then((l) => l());
      window.removeEventListener("keydown", key);
    };
  }, [navigate, toggleSidebar]);
  useEffect(() => {
    if (!isDesktop) return;
    const listener = listen<DashboardTarget>("tray-navigate", ({ payload }) => {
      navigate(
        `${payload.page === "overview" ? "/" : `/${payload.page}`}${payload.sessionKey ? `?session=${encodeURIComponent(payload.sessionKey)}` : ""}`,
      );
    });
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, [navigate]);
  useEffect(() => {
    const key = new URLSearchParams(location.search).get("session");
    if (!key) {
      u.setSelected(null);
      return;
    }
    let active = true;
    void usageApi
      .detail(key)
      .then((session) => {
        if (active) u.setSelected(session);
      })
      .catch((e) => {
        if (active) u.setNotice(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [location.search]);
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="projects" element={<Projects />} />
          <Route path="models" element={<Models />} />
          <Route path="settings" element={<UsageSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {whatsNewOpen && (
        <WhatsNewDialog onClose={() => setWhatsNewOpen(false)} />
      )}
      {u.selected && (
        <SessionDrawer
          session={u.selected}
          onClose={() => {
            u.setSelected(null);
            if (location.search) navigate(location.pathname, { replace: true });
          }}
        />
      )}
      <Onboarding />
      {u.notice && (
        <div className="toast" role="status">
          <UIcon name="info" size={17} />
          {u.notice}
          <button
            className="icon-button"
            onClick={() => u.setNotice("")}
            aria-label="Dismiss notification"
          >
            <UIcon name="close" size={15} />
          </button>
        </div>
      )}
    </>
  );
}
export function App() {
  return (
    <QueryClientProvider client={client}>
      <HashRouter>
        {new URLSearchParams(window.location.search).get("window") ===
        "tray" ? (
          <TrayPopover />
        ) : (
          <UsageProvider>
            <Application />
          </UsageProvider>
        )}
      </HashRouter>
    </QueryClientProvider>
  );
}
