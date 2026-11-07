import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./desktop";
import {
  demoAlias,
  demoAnnotate,
  demoBootstrap,
  demoDetail,
  demoView,
  demoCheckSessions,
  demoActivity,
} from "./demo";
import type {
  Annotation,
  Bootstrap,
  Preferences,
  ProjectIconData,
  Query,
  Session,
  ViewData,
} from "./usage-types";
import type { SessionActivity } from "./session-activity";
export const usageApi = {
  projectIcons: (paths: string[]): Promise<Record<string, ProjectIconData>> =>
    isDesktop
      ? invoke("get_project_icons", { paths })
      : Promise.resolve(
          Object.fromEntries(
            paths.map((path) => [
              path,
              {
                kind: path.endsWith("api-service") ? "gitlab" : "folder",
                source: path.endsWith("api-service")
                  ? "GitLab repository (synthetic)"
                  : "Project folder",
              },
            ]),
          ),
        ),
  activity: (keys: string[]): Promise<Record<string, SessionActivity>> =>
    isDesktop
      ? invoke("get_session_activity", { keys })
      : Promise.resolve(demoActivity(keys)),
  checkSessions: (keys: string[]): Promise<string[]> =>
    isDesktop
      ? invoke("check_sessions", { keys })
      : Promise.resolve(demoCheckSessions(keys)),
  bootstrap: (): Promise<Bootstrap> =>
    isDesktop
      ? invoke("get_bootstrap_status")
      : Promise.resolve(demoBootstrap()),
  view: (query: Query): Promise<ViewData> =>
    isDesktop
      ? invoke("get_view", { query })
      : Promise.resolve(demoView(query)),
  detail: (key: string): Promise<Session> =>
    isDesktop
      ? invoke("get_session_detail", { key })
      : Promise.resolve(demoDetail(key)),
  annotate: async (key: string, changes: Annotation) => {
    if (isDesktop) await invoke("update_session_metadata", { key, changes });
    else demoAnnotate(key, changes);
  },
  alias: async (path: string, alias: string) => {
    if (isDesktop) await invoke("set_project_alias", { path, alias });
    else demoAlias(path, alias);
  },
  cancel: async () => {
    if (isDesktop) await invoke("cancel_refresh");
  },
  refresh: async () => {
    if (isDesktop) await invoke("refresh_usage");
  },
  preferences: async (preferences: Preferences): Promise<Preferences> => {
    if (isDesktop) return invoke("set_preferences", { preferences });
    localStorage.setItem(
      "agent-usage.demo-preferences",
      JSON.stringify(preferences),
    );
    return preferences;
  },
  testEngine: (): Promise<{
    version: string;
    source: string;
    revision: string;
  }> =>
    isDesktop
      ? invoke("test_engine")
      : Promise.resolve({
          version: "20.0.48",
          source: "synthetic browser preview",
          revision: "2c92293",
        }),
  open: async (target: string, key?: string) => {
    if (!isDesktop)
      throw new Error("Local folder actions are available in the desktop app.");
    await invoke("open_local_target", { target, key: key || null });
  },
  clear: async () => {
    if (isDesktop) await invoke("clear_cache");
  },
  diagnostics: (): Promise<unknown> =>
    isDesktop
      ? invoke("get_diagnostics")
      : Promise.resolve({ preview: true, engineVersion: "20.0.48" }),
  export: async (report: string, query: Query, format: "csv" | "json") => {
    if (isDesktop)
      return invoke<string>("export_report", { report, query, format });
    const v = demoView({ ...query, offset: 0, limit: 100000 });
    const rows =
      report === "sessions"
        ? v.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            provider: s.provider,
            project: s.project,
            estimatedUsd:
              s.periodCostMicros == null ? null : s.periodCostMicros / 1e6,
            totalTokens: s.tokens.total,
          }))
        : report === "projects"
          ? v.projects.map((p) => ({
              project: p.name,
              sessions: p.sessions,
              estimatedUsd:
                p.periodCostMicros == null ? null : p.periodCostMicros / 1e6,
              totalTokens: p.tokens.total,
            }))
          : report === "models"
            ? v.models.map((m) => ({
                model: m.model,
                estimatedUsd: m.costMicros / 1e6,
                inputTokens: m.tokens.input,
                outputTokens: m.tokens.output,
                cacheReadTokens: m.tokens.cacheRead,
                cacheCreationTokens: m.tokens.cacheCreation,
                missingPricing: m.missingPricing,
              }))
            : v.daily;
    const metadata = {
      generatedAt: new Date().toISOString(),
      preview: true,
      timezone: v.timezone,
      providers: query.providers,
      since: query.since,
      until: query.until,
      costMode: v.costMode,
      ccusageVersion: v.engineVersion,
      costSemantics: "Estimated API-equivalent usage value",
      attribution: "event day within selected period",
    };
    if (format === "json") return JSON.stringify({ metadata, rows }, null, 2);
    const cell = (s: unknown) =>
      `"${String(s ?? "")
        .replace(/^(\s*[=+\-@\t\r])/, "'$1")
        .replaceAll('"', '""')}"`;
    const records = rows as unknown as Record<string, unknown>[];
    const columns = Object.keys(records[0] || {});
    return `${cell("metadata")},${cell(JSON.stringify(metadata))}\r\n${columns.map(cell).join(",")}\r\n${records.map((r) => columns.map((c) => cell(typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c])).join(",")).join("\r\n")}`;
  },
};
export function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}
