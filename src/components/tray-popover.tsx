import { useEffect, useLayoutEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { isDesktop } from "@/lib/desktop";
import { applyTheme, usePreferences } from "@/lib/preferences";
import { usageApi, errorMessage } from "@/lib/usage-api";
import { useTrayViewState } from "@/lib/view-state";
import { compact, dateKey, displayDate, modelName, time } from "@/lib/format";
import {
  dismissTray,
  openDashboard,
  quitFromTray,
  type DashboardTarget,
} from "@/lib/tray";
import { trayRecentOptions, trayTodayOptions } from "@/lib/tray-queries";
import { PeriodCost } from "@/components/period-cost";
import { sessionPeriodCost, periodCostDescription } from "@/lib/costs";
import { millisecondsUntilNextDay } from "@/lib/day-clock";
import { useSessionVisits } from "@/lib/use-session-visits";
import { useSessionActivity } from "@/lib/use-session-activity";
import { SessionActivityBadge } from "./session-activity-badge";
import { NewSessionBadge } from "./new-session-badge";
import { ProjectIcon } from "./project-icon";
import { ProviderMark, UIcon } from "./usage-icon";
import "@/styles/tray.css";

function relativeTime(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return "Unknown";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function TrayPopover() {
  const client = useQueryClient();
  const { provider, update } = useTrayViewState();
  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState("");
  const bootstrap = useQuery({
    queryKey: ["tray-bootstrap"],
    queryFn: usageApi.bootstrap,
  });
  const prefs = bootstrap.data?.preferences;
  const { theme } = usePreferences();
  const resolvedTheme = prefs?.theme ?? theme;
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      applyTheme(resolvedTheme);
      if (isDesktop)
        void import("@tauri-apps/api/window")
          .then(async ({ getCurrentWindow }) => {
            await getCurrentWindow().setTheme(
              resolvedTheme === "system" ? null : resolvedTheme,
            );
          })
          .catch(() => {});
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [resolvedTheme]);
  const timezone = prefs?.timezone || "local";
  const today = dateKey(new Date(now), timezone);
  const recent = useQuery({
    ...trayRecentOptions(provider, usageApi.view),
    enabled: !!bootstrap.data?.hasSnapshot,
  });
  const sessionActivity = useSessionActivity(
    recent.data?.sessions.map((s) => s.key) || [],
  );
  const isNewSession = useSessionVisits(
    recent.data?.sessions.map((s) => s.key) || [],
    true,
    recent.dataUpdatedAt,
  );
  const daily = useQuery({
    ...trayTodayOptions(now, timezone, usageApi.view),
    enabled: !!bootstrap.data?.hasSnapshot,
  });
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      millisecondsUntilNextDay(Date.now(), timezone),
    );
    return () => window.clearTimeout(timer);
  }, [today, timezone]);
  const invalidate = () =>
    client.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith("tray-"),
    });
  const refresh = useMutation({
    mutationFn: usageApi.refresh,
    onSettled: invalidate,
  });
  const busy = refresh.isPending || !!bootstrap.data?.scanning;
  const error =
    actionError ||
    (refresh.error ? errorMessage(refresh.error) : "") ||
    bootstrap.data?.lastError?.message ||
    (bootstrap.error ? errorMessage(bootstrap.error) : "") ||
    (recent.error ? errorMessage(recent.error) : "") ||
    (daily.error ? errorMessage(daily.error) : "");
  const stale = recent.data?.stale || daily.data?.stale;
  const open = (target: DashboardTarget) => {
    void openDashboard(target).catch((e) => setActionError(errorMessage(e)));
  };
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const focus = () => {
      setNow(Date.now());
      void invalidate();
    };
    const visible = () => {
      if (document.visibilityState === "visible") focus();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    document.addEventListener("visibilitychange", visible);
    const listeners = isDesktop
      ? Promise.all([
          listen("usage-updated", () => {
            void invalidate();
          }),
          listen("usage-refreshing", () => {
            void client.invalidateQueries({ queryKey: ["tray-bootstrap"] });
          }),
          listen("tray-opened", focus),
          listen("tray-day-changed", focus),
        ])
      : Promise.resolve([]);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      document.removeEventListener("visibilitychange", visible);
      void listeners.then((ls) => ls.forEach((l) => l()));
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void dismissTray();
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (!busy) refresh.mutate();
      }
      if (event.key === ",") {
        event.preventDefault();
        open({ page: "settings" });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy]);
  const summary = daily.data?.summary;
  return (
    <main
      className={`tray-popover ${!isDesktop ? "tray-browser-preview" : ""}`}
      aria-label="AI Coding Usage quick view"
    >
      <header className="tray-header">
        <div className="tray-brand">
          <span className="tray-brand-icon">
            <UIcon name="activity" size={18} />
          </span>
          <span>AI Coding Usage</span>
        </div>
        <div className="tray-tools">
          <button
            className="tray-icon-button"
            title="Refresh (⌘/Ctrl R)"
            aria-label="Refresh usage"
            disabled={busy}
            onClick={() => refresh.mutate()}
          >
            <UIcon
              name="refresh"
              size={16}
              className={busy ? "spinning" : ""}
            />
          </button>
          <button
            className="tray-icon-button"
            title="Settings"
            aria-label="Open settings"
            onClick={() => open({ page: "settings" })}
          >
            <UIcon name="settings" size={17} />
          </button>
        </div>
      </header>
      {!isDesktop && (
        <div className="tray-preview-label">Synthetic preview</div>
      )}
      <section className="tray-today" aria-label="Today's usage">
        <div className="tray-today-heading">
          <span>Today</span>
          <span>{displayDate(today, { month: "short", day: "numeric" })}</span>
        </div>
        <div className="tray-today-total">
          <strong>
            <PeriodCost
              value={summary?.costMicros}

              label="today"
              partial={summary?.missingPricing}
            />
          </strong>
          <div>
            <span title={periodCostDescription}>Est. API value today</span>
            <small>
              {summary
                ? `${compact(summary.tokens.total)} tokens today`
                : "No snapshot yet"}
            </small>
          </div>
        </div>
        <div className="tray-provider-totals">
          {(["claude", "codex"] as const).map((p) => (
            <div key={p}>
              <ProviderMark provider={p} label />
              <strong>
                <PeriodCost
                  value={
                    daily.data
                      ? daily.data.daily
                          .filter((d) => d.provider === p)
                          .reduce((sum, d) => sum + d.costMicros, 0)
                      : null
                  }

                  label="today"
                  partial={daily.data?.daily.some(
                    (d) => d.provider === p && d.missingPricing,
                  )}
                />
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="tray-recent" aria-labelledby="tray-recent-title">
        <div className="tray-section-heading">
          <h1 id="tray-recent-title">Recent sessions</h1>
          <button onClick={() => open({ page: "sessions" })}>
            View all <UIcon name="arrow" size={13} />
          </button>
        </div>
        <div
          className="tray-filters"
          role="group"
          aria-label="Filter sessions by provider"
        >
          {(["all", "claude", "codex"] as const).map((p) => (
            <button
              key={p}
              aria-pressed={provider === p}
              onClick={() => update({ provider: p })}
            >
              {p === "all"
                ? "All agents"
                : p === "claude"
                  ? "Claude Code"
                  : "Codex"}
            </button>
          ))}
        </div>
        <div className="tray-session-scroll" aria-busy={recent.isFetching}>
          {bootstrap.isPending ||
          (bootstrap.data?.hasSnapshot && recent.isPending) ? (
            <div className="tray-empty" role="status">
              <UIcon name="refresh" className="spinning" size={22} />
              <strong>Loading recent sessions…</strong>
            </div>
          ) : recent.data?.sessions.length ? (
            <ul className="tray-session-list">
              {recent.data.sessions.map((s) => (
                <li key={s.key}>
                  <button
                    className="tray-session"
                    onClick={() =>
                      open({ page: "sessions", sessionKey: s.key })
                    }
                  >
                    <span className={`tray-session-icon ${s.provider}`}>
                      <ProviderMark provider={s.provider} />
                    </span>
                    <span className="tray-session-content">
                      <span className="tray-session-title" title={s.title}>
                        {s.title}
                      </span>
                      <span
                        className="tray-session-project"
                        title={s.projectPath}
                      >
                        <ProjectIcon path={s.projectPath} size={12} />
                        <span>{s.project || "No project"}</span>
                        <span className="tray-separator">·</span>
                        <span>
                          {modelName(s.models[0]?.model || s.provider)}
                        </span>
                      </span>
                      <span className="tray-session-meta">
                        <SessionActivityBadge state={sessionActivity(s.key)} />
                        {isNewSession(s.key) && <NewSessionBadge />}
                        <time
                          dateTime={s.lastActivity}
                          title={`${displayDate(dateKey(new Date(s.lastActivity), timezone))} · ${time(s.lastActivity, timezone)}`}
                        >
                          {relativeTime(s.lastActivity, now)}
                        </time>
                        <span>·</span>
                        <span>{compact(s.tokens.total)} tokens</span>
                      </span>
                    </span>
                    <span className="tray-session-value">
                      <strong>
                        <PeriodCost
                          value={sessionPeriodCost(s, today, today)}

                          label="today"
                          partial={s.missingPricing}
                        />
                      </strong>
                      <UIcon name="chevron" size={12} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="tray-empty">
              <UIcon name="sessions" size={26} />
              <strong>
                {error ? "Sessions unavailable" : "No sessions yet"}
              </strong>
              <p>
                {error
                  ? "Try refreshing your local usage data."
                  : "Your recent Claude Code and Codex sessions will appear here."}
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  prefs?.onboarded
                    ? refresh.mutate()
                    : open({ page: "settings" })
                }
              >
                {prefs?.onboarded
                  ? "Scan local sessions"
                  : "Connect your sources"}
              </button>
            </div>
          )}
        </div>
        <p className="tray-cost-note">Session costs show today’s usage.</p>
      </section>
      {(error || stale) && (
        <div className="tray-warning" role="status">
          <UIcon name="info" size={14} />
          <span>
            {error || "Showing a cached snapshot. Refresh to update."}
          </span>
          <button
            disabled={busy}
            onClick={() => {
              setActionError("");
              refresh.mutate();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <footer className="tray-footer">
        <span className="tray-freshness" role="status">
          <i
            className={
              error || stale ? "warning" : busy || !recent.data ? "pending" : ""
            }
          />
          {busy
            ? "Refreshing…"
            : recent.data
              ? `${stale || error ? "Cached" : "Updated"} ${relativeTime(recent.data.scannedAt, now).toLowerCase()}`
              : "Not yet scanned"}
        </span>
        <button
          className="tray-icon-button"
          title="Quit AI Coding Usage"
          aria-label="Quit AI Coding Usage"
          onClick={() =>
            void quitFromTray().catch((e) => setActionError(errorMessage(e)))
          }
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 3v9M7 5.5a9 9 0 1 0 10 0" />
          </svg>
        </button>
        <button
          className="tray-dashboard-button"
          onClick={() => open({ page: "overview" })}
        >
          Open dashboard <UIcon name="external" size={12} />
        </button>
      </footer>
    </main>
  );
}
