import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultQuery, type Query } from "./usage-types.ts";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

interface DashboardView {
  pathname: string;
  range: string | null;
  provider: string;
  customSince: string;
  customUntil: string;
  dayOverride: string | null;
  filters: Query;
  chartMetric: string;
  chartAggregation: string;
  projectSort: string;
  modelSort: string;
  settingsSection: string;
  settingsSearch: string;
  sessionFiltersOpen: boolean;
  hiddenSessionColumns: string[];
}

const paths = ["/", "/sessions", "/projects", "/models", "/settings"];
const ranges = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "month",
  "lastMonth",
  "custom",
  "all",
];
const providers = ["all", "claude", "codex"] as const;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const choice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && choices.includes(value as T)
    ? (value as T)
    : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const amount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const date = (value: unknown) => {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return "";
  const parsed = new Date(`${result}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === result
    ? result
    : "";
};

function sessionFilters(value: unknown): Query {
  const saved = record(value);
  return {
    ...defaultQuery,
    search: text(saved.search),
    projects: strings(saved.projects),
    models: strings(saved.models),
    favorite: saved.favorite === true,
    tag: text(saved.tag),
    sourceId: text(saved.sourceId),
    provenance: choice(
      saved.provenance,
      ["native", "prompt", "local", "identifier"],
      "",
    ),
    minCost: amount(saved.minCost),
    maxCost: amount(saved.maxCost),
    minTokens: amount(saved.minTokens),
    maxTokens: amount(saved.maxTokens),
    sort: choice(
      saved.sort,
      ["last", "name", "provider", "project", "tokens", "cost", "periodCost"],
      defaultQuery.sort,
    ),
    descending:
      typeof saved.descending === "boolean"
        ? saved.descending
        : defaultQuery.descending,
    groupBy: choice(
      saved.groupBy,
      ["day", "week", "month", "project", "provider", "none"],
      defaultQuery.groupBy,
    ),
    descendingGroups:
      typeof saved.descendingGroups === "boolean"
        ? saved.descendingGroups
        : defaultQuery.descendingGroups,
  };
}

function dashboardView(value: unknown): DashboardView {
  const saved = record(value);
  return {
    pathname: choice(saved.pathname, paths, "/"),
    // Null means no selection yet: use the configured default until one is made.
    range:
      typeof saved.range === "string" && ranges.includes(saved.range)
        ? saved.range
        : null,
    provider: choice(saved.provider, providers, "all"),
    customSince: date(saved.customSince),
    customUntil: date(saved.customUntil),
    dayOverride: date(saved.dayOverride) || null,
    filters: sessionFilters(saved.filters),
    chartMetric: choice(saved.chartMetric, ["cost", "tokens"], "cost"),
    chartAggregation: choice(
      saved.chartAggregation,
      ["day", "week", "month"],
      "day",
    ),
    projectSort: choice(
      saved.projectSort,
      ["periodCost", "sessions", "last", "name"],
      "periodCost",
    ),
    modelSort: choice(saved.modelSort, ["cost", "output", "name"], "cost"),
    settingsSection: choice(
      saved.settingsSection,
      [
        "General",
        "Sources",
        "Engine & costs",
        "Refresh & tray",
        "Privacy & data",
        "About",
      ],
      "General",
    ),
    settingsSearch: text(saved.settingsSearch),
    sessionFiltersOpen: saved.sessionFiltersOpen === true,
    hiddenSessionColumns: strings(saved.hiddenSessionColumns).filter((column) =>
      ["project", "models", "tokens"].includes(column),
    ),
  };
}

function savedStore<T extends object>(
  name: string,
  restore: (saved: unknown) => T,
  storage?: Storage,
) {
  const target = () =>
    storage ??
    (typeof window === "undefined" ? undefined : window.localStorage);
  type State = T & {
    update: (changes: Partial<T> | ((state: T) => Partial<T>)) => void;
  };
  return create<State>()(
    persist<State, [], [], T>(
      (set) => ({
        ...restore(null),
        update: (changes) =>
          set((state) => ({
            ...state,
            ...(typeof changes === "function" ? changes(state) : changes),
          })),
      }),
      {
        name,
        version: 1,
        storage: createJSONStorage<T>(() => ({
          getItem: (key) => {
            try {
              return target()?.getItem(key) ?? null;
            } catch {
              return null;
            }
          },
          setItem: (key, value) => {
            try {
              target()?.setItem(key, value);
            } catch {
              /* Keep this launch usable when storage is unavailable. */
            }
          },
          removeItem: (key) => {
            try {
              target()?.removeItem(key);
            } catch {
              /* Storage may be disabled. */
            }
          },
        })),
        partialize: restore,
        merge: (saved, current) => ({ ...current, ...restore(saved) }),
      },
    ),
  );
}

export const createViewStore = (storage?: Storage) =>
  savedStore("agent-usage.dashboard-view", dashboardView, storage);
export const useViewState = createViewStore();

export const createTrayViewStore = (storage?: Storage) =>
  savedStore(
    "agent-usage.tray-view",
    (saved) => ({
      provider: choice(record(saved).provider, providers, "all"),
    }),
    storage,
  );
export const useTrayViewState = createTrayViewStore();

export function initialDashboardHash(
  location: { hash: string; search: string },
  pathname: string,
) {
  if (
    location.hash ||
    new URLSearchParams(location.search).get("window") === "tray"
  )
    return location.hash;
  return paths.includes(pathname) && pathname !== "/" ? `#${pathname}` : "";
}
