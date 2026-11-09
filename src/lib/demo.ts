import type { SessionActivity } from "./session-activity";
import {
  defaultPreferences,
  type Annotation,
  type Bootstrap,
  type DailyUsage,
  type ModelUsage,
  type ProjectSummary,
  type Query,
  type Session,
  type Source,
  type Summary,
  type Tokens,
  type ViewData,
} from "./usage-types";
import { dateKey } from "./format";
import { sessionGroupsDescending } from "./session-sort";
import { sessionPeriodCost, sessionModelPeriodCost } from "./costs";
import { sessionFirstUsageDate, sessionInPeriod } from "./session-days";
const zero = (): Tokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 0,
});
function add(a: Tokens, b: Tokens) {
  (Object.keys(a) as (keyof Tokens)[]).forEach((k) => (a[k] += b[k]));
}
const projects = [
  "workbench",
  "design-system",
  "api-service",
  "personal-site",
  "agent-tools",
  "docs",
];
const titles = [
  "Refine the command palette",
  "Add streaming response support",
  "Fix authentication redirect loop",
  "Build the project settings screen",
  "Improve keyboard navigation",
  "Investigate slow database queries",
  "Migrate the token parser",
  "Polish empty states and loading",
  "Add tests for date boundaries",
  "Simplify the deployment pipeline",
  "Review the accessibility audit",
  "Implement session grouping",
  "Update the documentation",
  "Extract shared form components",
  "Debug the connection retry logic",
  "Optimize the search index",
  "Add CSV report exports",
  "Refactor API error handling",
];
const sources: Source[] = [
  {
    id: "demo-claude",
    provider: "claude",
    root: "~/.claude",
    status: "ready",
    sessionCount: 0,
  },
  {
    id: "demo-codex",
    provider: "codex",
    root: "~/.codex",
    status: "ready",
    sessionCount: 0,
  },
];
const allSessions: Session[] = [];
const allDaily: DailyUsage[] = [];
for (let day = 58; day >= 0; day--) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - day);
  const key = dateKey(date);
  const weekend = [0, 6].includes(date.getDay());
  const count = weekend ? (day % 3 ? 0 : 2) : 2 + ((day * 7) % 5);
  for (let i = 0; i < count; i++) {
    const seed = day * 13 + i * 7 + 3;
    const provider = seed % 3 ? "claude" : "codex";
    const model =
      provider === "claude"
        ? seed % 4
          ? "claude-sonnet-4-20250514"
          : "claude-opus-4-20250514"
        : "gpt-5";
    const tokens: Tokens = {
      input: 16000 + seed * 601,
      output: 2500 + seed * 21,
      cacheRead: 45000 + seed * 2300,
      cacheCreation: provider === "claude" ? 9000 + seed * 34 : 0,
      total: 0,
    };
    tokens.total =
      tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
    const costMicros = 160000 + ((seed * 19397) % 7200000);
    const m: ModelUsage = {
      model,
      tokens,
      costMicros,
      missingPricing: false,
      isFallback: false,
    };
    const at = new Date(date);
    at.setHours(8 + i * 2, seed % 60);
    const first = new Date(at.getTime() - ((seed % 80) + 10) * 60000);
    const project = projects[seed % projects.length];
    const id = `${provider}-demo-${day}-${i}`;
    allSessions.push({
      key: id,
      id,
      provider,
      sourceId: `demo-${provider}`,
      title: titles[seed % titles.length],
      nativeTitle: titles[seed % titles.length],
      titleProvenance: seed % 6 ? "native" : "prompt",
      project,
      projectPath: `/synthetic/${project}`,
      sourcePath: null,
      firstActivity: first.toISOString(),
      lastActivity: at.toISOString(),
      activityDays: [key],
      dailyUsage: [
        {
          date: key,
          provider,
          tokens: structuredClone(tokens),
          costMicros,
          models: [structuredClone(m)],
          missingPricing: false,
        },
      ],
      tokens,
      costMicros,
      models: [m],
      missingPricing: false,
      favorite: seed % 11 === 0,
      tags: seed % 11 === 0 ? ["review"] : [],
      sourceStatus: "verified",
    });
    let d = allDaily.find((d) => d.date === key && d.provider === provider);
    if (!d) {
      d = {
        date: key,
        provider,
        tokens: zero(),
        costMicros: 0,
        models: [],
        missingPricing: false,
      };
      allDaily.push(d);
    }
    add(d.tokens, tokens);
    d.costMicros += costMicros;
    const prior = d.models.find((m) => m.model === model);
    if (prior) {
      add(prior.tokens, tokens);
      prior.costMicros += costMicros;
    } else d.models.push(structuredClone(m));
  }
}
const spanning = allSessions.at(-1)!;
const priorDate = new Date(spanning.firstActivity);
priorDate.setDate(priorDate.getDate() - 1);
const priorDay: DailyUsage = {
  date: dateKey(priorDate),
  provider: spanning.provider,
  tokens: structuredClone(spanning.tokens),
  costMicros: 1_800_000,
  models: [{ ...structuredClone(spanning.models[0]), costMicros: 1_800_000 }],
  missingPricing: false,
};
spanning.dailyUsage!.unshift(priorDay);
spanning.activityDays.unshift(priorDay.date);
spanning.firstActivity = priorDate.toISOString();
spanning.costMicros += priorDay.costMicros;
add(spanning.tokens, priorDay.tokens);
spanning.models = [
  {
    ...spanning.models[0],
    costMicros: spanning.costMicros,
    tokens: structuredClone(spanning.tokens),
  },
];
allDaily.push(structuredClone(priorDay));
const metadata = new Map<string, Annotation>();
const aliases = new Map<string, string>();
function prefs() {
  try {
    return {
      ...defaultPreferences,
      ...JSON.parse(
        localStorage.getItem("agent-usage.demo-preferences") || "{}",
      ),
    };
  } catch {
    return defaultPreferences;
  }
}
export function demoBootstrap(): Bootstrap {
  return {
    preferences: prefs(),
    sources,
    hasSnapshot: true,
    scanning: false,
    engineVersion: "20.0.48",
    trayAvailable: false,
  };
}
export function demoActivity(keys: string[]): Record<string, SessionActivity> {
  const latest = allSessions.slice(-2).reverse();
  return Object.fromEntries(
    latest
      .filter((s) => keys.includes(s.key))
      .map((s, index) => [
        s.key,
        {
          state: index === 0 ? "working" : "recent",
          observedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
      ]),
  );
}

export function demoCheckSessions(keys: string[]): string[] {
  const storageKey = "agent-usage.demo-checked-sessions";
  const saved = localStorage.getItem(storageKey);
  // First use treats existing history as checked, just like the native store.
  const checked = new Set<string>(
    saved ? JSON.parse(saved) : allSessions.map((s) => s.key),
  );
  const unread = keys.filter((key) => !checked.has(key));
  keys.forEach((key) => checked.add(key));
  localStorage.setItem(storageKey, JSON.stringify([...checked]));
  return unread;
}
export function demoAnnotate(key: string, a: Annotation) {
  metadata.set(key, a);
}
export function demoAlias(path: string, name: string) {
  aliases.set(path, name);
}
export function demoDetail(key: string) {
  return decorated().find((s) => s.key === key)!;
}
function decorated() {
  return allSessions.map((s) => {
    const a = metadata.get(s.key);
    return {
      ...s,
      project: aliases.get(s.projectPath) || s.project,
      ...(a
        ? {
            title: a.title || s.title,
            titleProvenance: a.title ? "local" : s.titleProvenance,
            favorite: a.favorite,
            tags: a.tags,
          }
        : {}),
    };
  });
}
export function demoView(q: Query): ViewData {
  const provider = (p: string) =>
    !q.providers.length || q.providers.includes(p);
  const inDate = (d: string) =>
    (!q.since || d >= q.since) && (!q.until || d <= q.until);
  const daily = allDaily.filter((d) => provider(d.provider) && inDate(d.date));
  const active = decorated().filter(
    (s) =>
      provider(s.provider) &&
      sessionInPeriod(s, q.since, q.until, prefs().timezone),
  );
  const sessions = active
    .filter(
      (s) =>
        `${s.title} ${s.id} ${s.project} ${s.projectPath}`
          .toLowerCase()
          .includes(q.search.toLowerCase()) &&
        (!q.projects.length || q.projects.includes(s.projectPath)) &&
        (!q.models.length ||
          s.models.some((m) => q.models.includes(m.model))) &&
        (!q.favorite || s.favorite) &&
        (!q.tag || s.tags.includes(q.tag)) &&
        (!q.provenance || s.titleProvenance === q.provenance) &&
        (!q.sourceId || s.sourceId === q.sourceId) &&
        (q.minCost === null ||
          (sessionPeriodCost(s, q.since, q.until) ?? -1) >= q.minCost * 1e6) &&
        (q.maxCost === null ||
          (sessionPeriodCost(s, q.since, q.until) ?? Infinity) <=
            q.maxCost * 1e6) &&
        (q.minTokens === null || s.tokens.total >= q.minTokens) &&
        (q.maxTokens === null || s.tokens.total <= q.maxTokens),
    )
    .map((s) => ({
      ...s,
      periodCostMicros: sessionPeriodCost(s, q.since, q.until),
      models: s.models.map((m) => ({
        ...m,
        periodCostMicros: sessionModelPeriodCost(s, m.model, q.since, q.until),
      })),
    }));
  const summary: Summary = {
    tokens: zero(),
    costMicros: 0,
    lifetimeCostMicros: active.reduce((sum, s) => sum + s.costMicros, 0),
    sessions: active.length,
    projects: new Set(active.map((s) => s.projectPath)).size,
    activeDays: new Set(daily.map((d) => d.date)).size,
    missingPricing: false,
  };
  daily.forEach((d) => {
    add(summary.tokens, d.tokens);
    summary.costMicros += d.costMicros;
  });
  const pm = new Map<string, ProjectSummary>();
  sessions.forEach((s) => {
    let p = pm.get(s.projectPath);
    if (!p) {
      p = {
        key: s.projectPath,
        name: s.project,
        tokens: zero(),
        costMicros: 0,
        periodCostMicros: 0,
        sessions: 0,
        lastActivity: s.lastActivity,
        claudeMicros: 0,
        codexMicros: 0,
        topModel: s.models[0].model,
      };
      pm.set(s.projectPath, p);
    }
    add(p.tokens, s.tokens);
    p.costMicros += s.costMicros;
    p.periodCostMicros =
      p.periodCostMicros == null || s.periodCostMicros == null
        ? null
        : p.periodCostMicros + s.periodCostMicros;
    p.sessions++;
    p.lastActivity =
      s.lastActivity > p.lastActivity ? s.lastActivity : p.lastActivity;
    p[s.provider === "claude" ? "claudeMicros" : "codexMicros"] +=
      s.periodCostMicros ?? 0;
  });
  const mm = new Map<string, ModelUsage>();
  daily
    .flatMap((d) => d.models)
    .forEach((m) => {
      const prior = mm.get(m.model);
      if (prior) {
        add(prior.tokens, m.tokens);
        prior.costMicros += m.costMicros;
      } else mm.set(m.model, structuredClone(m));
    });
  const by = (s: Session): number | string =>
    ({
      cost: s.periodCostMicros ?? -1,
      periodCost: s.periodCostMicros ?? -1,
      tokens: s.tokens.total,
      input: s.tokens.input,
      output: s.tokens.output,
      cache: s.tokens.cacheRead,
      name: s.title,
      project: s.project,
      provider: s.provider,
      first: `${sessionFirstUsageDate(s, prefs().timezone) ?? ""} ${s.firstActivity}`,
      last: s.lastActivity,
    })[q.sort as "last"] ?? s.lastActivity;
  const groupKey = (s: Session) => {
    const d = dateKey(new Date(s.lastActivity), prefs().timezone);
    if (q.groupBy === "none") return "All sessions";
    if (q.groupBy === "provider") return s.provider;
    if (q.groupBy === "project") return s.projectPath;
    if (q.groupBy === "month") return d.slice(0, 7);
    if (q.groupBy === "week") {
      const day = new Date(`${d}T12:00:00`);
      day.setDate(
        day.getDate() -
          (q.weekStart === "sunday" ? day.getDay() : (day.getDay() + 6) % 7),
      );
      return dateKey(day);
    }
    return d;
  };
  const groupPeriodTotals: Record<string, number | null> = {};
  const groupTotals: Record<string, [number, number]> = {};
  sessions.forEach((s) => {
    const k = groupKey(s);
    if (!groupTotals[k]) groupTotals[k] = [0, 0];
    groupTotals[k][0]++;
    groupTotals[k][1] += s.costMicros;
    groupPeriodTotals[k] =
      groupPeriodTotals[k] === null || s.periodCostMicros == null
        ? null
        : (groupPeriodTotals[k] ?? 0) + s.periodCostMicros;
  });
  const descendingGroups = sessionGroupsDescending(q);
  sessions.sort((a, b) => {
    const groupOrder = groupKey(a).localeCompare(groupKey(b));
    if (groupOrder) return groupOrder * (descendingGroups ? -1 : 1);
    const av = by(a),
      bv = by(b);
    return (av < bv ? -1 : av > bv ? 1 : 0) * (q.descending ? -1 : 1);
  });
  return {
    groupTotals,
    groupPeriodTotals,
    providerLifetimeCosts: Object.fromEntries(
      ["claude", "codex"].map((p) => [
        p,
        active
          .filter((s) => s.provider === p)
          .reduce((sum, s) => sum + s.costMicros, 0),
      ]),
    ),
    summary,
    previous: null,
    sessions: sessions.slice(q.offset, q.offset + q.limit),
    sessionCount: sessions.length,
    daily,
    projects: [...pm.values()].sort(
      (a, b) => (b.periodCostMicros ?? -1) - (a.periodCostMicros ?? -1),
    ),
    models: [...mm.values()]
      .map((m) => ({
        ...m,
        lifetimeCostMicros: sessions
          .flatMap((s) => s.models)
          .filter((usage) => usage.model === m.model)
          .reduce((sum, usage) => sum + usage.costMicros, 0),
      }))
      .sort((a, b) => b.costMicros - a.costMicros),
    topSessions: [...sessions]
      .sort((a, b) => (b.periodCostMicros ?? -1) - (a.periodCostMicros ?? -1))
      .slice(0, 5),
    sources: sources.map((s) => ({
      ...s,
      sessionCount: allSessions.filter((r) => r.provider === s.provider).length,
    })),
    scannedAt: new Date().toISOString(),
    engineVersion: "20.0.48",
    timezone: prefs().timezone,
    costMode: prefs().costMode,
    stale: false,
    warnings: [
      "Synthetic preview data. Open the desktop app to read your local usage.",
    ],
    availableProjects: projects.map((p) => [
      `/synthetic/${p}`,
      aliases.get(`/synthetic/${p}`) || p,
    ]),
    availableModels: [
      ...new Set(allDaily.flatMap((d) => d.models.map((m) => m.model))),
    ],
  };
}
