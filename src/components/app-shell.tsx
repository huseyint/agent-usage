import { NavLink, Outlet, useLocation } from "react-router";
import { useUsage } from "@/lib/usage-context";
import { usageApi } from "@/lib/usage-api";
import { isDesktop, isMac, isWindows } from "@/lib/desktop";
import { usePreferences } from "@/lib/preferences";
import { time } from "@/lib/format";
import { UIcon, ProviderMark, type UsageIconName } from "./usage-icon";
import { MetadataStatus } from "./metadata-status";
import { PopupMenu } from "./popup-menu";
import { SourceNavItem } from "./source-nav-item";
import { WindowControls } from "./window-controls";
const providers = [
  { id: "all", label: "All providers" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

function ProviderSelectIcon({ provider }: { provider: string }) {
  if (provider === "all") return null;

  return (
    <span className="provider-select-icons" aria-hidden="true">
      <ProviderMark provider={provider} />
    </span>
  );
}

const views: { path: string; label: string; icon: UsageIconName }[] = [
  { path: "/", label: "Overview", icon: "overview" },
  { path: "/sessions", label: "Sessions", icon: "sessions" },
  { path: "/projects", label: "Projects", icon: "projects" },
  { path: "/models", label: "Models", icon: "models" },
];
export function AppShell() {
  const u = useUsage();
  const { sidebarVisible, toggleSidebar } = usePreferences();
  const location = useLocation();
  const sources = u.view.data?.sources || u.bootstrap.data?.sources || [];
  const scanning = u.refresh.isPending || u.bootstrap.data?.scanning;
  return (
    <div
      className={`usage-shell ${isDesktop ? "desktop-shell" : "browser-shell"} ${sidebarVisible ? "" : "nav-collapsed"}`}
    >
      <header className="desktop-titlebar" data-tauri-drag-region>
        {isDesktop && isMac && (
          <div className="window-controls-space" data-tauri-drag-region />
        )}
        <button
          type="button"
          className="icon-button sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarVisible ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={sidebarVisible ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarVisible}
          aria-controls="main-navigation"
        >
          <UIcon
            name={sidebarVisible ? "sidebar-collapse" : "sidebar-expand"}
            size={18}
          />
        </button>
        <span className="chrome-name" data-tauri-drag-region>
          AI Coding Usage
        </span>
        <div className="grow" data-tauri-drag-region />
        {!isDesktop && <span className="demo-label">Synthetic preview</span>}
        {location.pathname !== "/settings" && (
          <>
            <div className="provider-select">
              <PopupMenu
                label={
                  providers.find((provider) => provider.id === u.provider)
                    ?.label || "All providers"
                }
                icon={<ProviderSelectIcon provider={u.provider} />}
                native={false}
                items={providers.map((provider) => ({
                  ...provider,
                  icon: <ProviderSelectIcon provider={provider.id} />,
                  checked: u.provider === provider.id,
                  onSelect: () => {
                    u.setProvider(provider.id);
                    u.updateFilters({ offset: 0 });
                  },
                }))}
              />
            </div>
            <label className="select-control">
              <UIcon name="calendar" size={15} />
              <span className="sr-only">Date range</span>
              <select
                aria-label="Date range"
                value={u.dayOverride ? "custom" : u.range}
                onChange={(e) => u.setRange(e.target.value)}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="month">This month</option>
                <option value="lastMonth">Last month</option>
                <option value="custom">Custom range</option>
                <option value="all">All time</option>
              </select>
            </label>
          </>
        )}
        <button
          className="icon-button refresh-button"
          title={scanning ? "Cancel refresh" : "Refresh local usage"}
          aria-label={scanning ? "Cancel refresh" : "Refresh local usage"}
          onClick={() =>
            scanning ? void usageApi.cancel() : u.refresh.mutate()
          }
        >
          <UIcon
            name="refresh"
            size={17}
            className={scanning ? "spinning" : ""}
          />
        </button>
        {isDesktop && isWindows && <WindowControls />}
      </header>
      <div className="application-body">
        <aside
          id="main-navigation"
          className="usage-nav"
          aria-label="Main navigation"
        >
          <nav>
            {views.map((v) => (
              <NavLink
                key={v.path}
                to={v.path}
                end
                className="usage-nav-link"
                title={v.label}
              >
                <UIcon name={v.icon} size={18} />
                <span>{v.label}</span>
                {v.path === "/sessions" && u.view.data && (
                  <small>{u.view.data.summary.sessions}</small>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="nav-spacer" />
          <div className="source-nav">
            <div className="nav-section-label">Sources</div>
            {(["claude", "codex"] as const).map((p) => {
              const ready = sources.some(
                (s) => s.provider === p && s.status === "ready",
              );
              const allowance =
                p === "claude"
                  ? u.prefs.claudeMonthlyAllowanceUsd
                  : u.prefs.codexMonthlyAllowanceUsd;
              return (
                <SourceNavItem
                  key={p}
                  provider={p}
                  ready={ready}
                  allowance={allowance}
                />
              );
            })}
          </div>
          <NavLink
            aria-label="Settings"
            title="Settings"
            className="usage-nav-link settings-nav"
            to="/settings"
          >
            <UIcon name="settings" size={18} />
            <span>Settings</span>
            <kbd>{isMac ? "⌘ ," : "Ctrl ,"}</kbd>
          </NavLink>
        </aside>
        <div className="usage-main">
          {u.range === "custom" && !u.dayOverride && (
            <div className="custom-date-bar">
              <label>
                From
                <input
                  type="date"
                  aria-label="Custom start date"
                  value={u.customSince}
                  onChange={(e) => u.setCustomSince(e.target.value)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  aria-label="Custom end date"
                  value={u.customUntil}
                  onChange={(e) => u.setCustomUntil(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => u.setRange("all")}
              >
                <UIcon name="close" size={14} />
                Clear date filter
              </button>
            </div>
          )}
          <main id="main-content" className="page-scroll">
            <Outlet />
          </main>
          <footer className="usage-statusbar">
            <span
              className={`status-dot ${u.view.data && !u.view.data.stale ? "ok" : ""}`}
            />
            <span>
              {scanning
                ? "Refreshing local sources…"
                : u.view.data?.stale
                  ? "Stale cached snapshot"
                  : u.view.data
                    ? "Local sources verified"
                    : "Waiting for local sources"}
            </span>
            <MetadataStatus />
            <div className="grow" />
            <span>
              {u.view.data
                ? `Last verified ${time(u.view.data.scannedAt, u.prefs.timezone)}`
                : "No verified snapshot"}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
