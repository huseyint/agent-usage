import test from "node:test";
import assert from "node:assert/strict";
import {
  createViewStore,
  createTrayViewStore,
  initialDashboardHash,
} from "../src/lib/view-state.ts";
import { defaultQuery } from "../src/lib/usage-types.ts";
import { rangeDates } from "../src/lib/format.ts";

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
}

test("view selections survive a fresh store while request pagination and derived dates reset", () => {
  const storage = memoryStorage();
  const first = createViewStore(storage);
  first.getState().update({
    pathname: "/sessions",
    range: "custom",
    provider: "codex",
    customSince: "2026-10-01",
    customUntil: "2026-10-31",
    filters: {
      ...defaultQuery,
      search: "review",
      projects: ["/synthetic/project"],
      models: ["gpt-test"],
      favorite: true,
      tag: "fix",
      sourceId: "synthetic-codex",
      provenance: "local",
      minCost: 0.5,
      maxCost: 10,
      minTokens: 100,
      maxTokens: 9000,
      sort: "name",
      descending: false,
      groupBy: "project",
      descendingGroups: false,
      offset: 800,
      limit: 999,
      since: "2020-01-01",
      until: "2020-02-01",
      providers: ["claude"],
      weekStart: "sunday",
    },
    chartMetric: "tokens",
    chartAggregation: "week",
    projectSort: "name",
    modelSort: "output",
    settingsSection: "Sources",
    settingsSearch: "source",
    sessionFiltersOpen: true,
    hiddenSessionColumns: ["models"],
  });
  const { update: _firstUpdate, ...before } = first.getState();
  const { update: _secondUpdate, ...after } =
    createViewStore(storage).getState();
  assert.deepEqual(after, {
    ...before,
    filters: {
      ...before.filters,
      offset: 0,
      limit: defaultQuery.limit,
      since: null,
      until: null,
      providers: [],
      weekStart: defaultQuery.weekStart,
    },
  });
});

test("relative ranges remain rolling presets and calendar drilldowns keep their selected day", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-10T12:00:00Z"),
  });
  const storage = memoryStorage();
  assert.equal(createViewStore(storage).getState().range, null);
  createViewStore(storage).getState().update({ range: "7d" });
  const restored = createViewStore(storage);
  assert.equal(restored.getState().range, "7d");
  assert.deepEqual(rangeDates(restored.getState().range, "UTC", "", ""), [
    "2026-11-04",
    "2026-11-10",
  ]);
  t.mock.timers.setTime(new Date("2026-11-12T12:00:00Z").getTime());
  assert.deepEqual(
    rangeDates(createViewStore(storage).getState().range, "UTC", "", ""),
    ["2026-11-06", "2026-11-12"],
  );
  restored.getState().update({ dayOverride: "2026-11-03" });
  assert.equal(createViewStore(storage).getState().dayOverride, "2026-11-03");
});

test("search and reset changes are written synchronously before the next launch", () => {
  const storage = memoryStorage();
  const store = createViewStore(storage);
  store.getState().update((state) => ({
    filters: { ...state.filters, search: "just typed", favorite: true },
  }));
  assert.equal(
    createViewStore(storage).getState().filters.search,
    "just typed",
  );
  store.getState().update({ filters: defaultQuery });
  assert.deepEqual(createViewStore(storage).getState().filters, defaultQuery);
});

test("partial, malformed and invalid saved views fall back without restoring transient state", () => {
  const storage = memoryStorage();
  const key = "agent-usage.dashboard-view";
  for (const invalid of ["{", "null", "[]"]) {
    storage.setItem(key, invalid);
    assert.equal(createViewStore(storage).getState().pathname, "/");
  }
  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      state: {
        pathname: "/unknown",
        range: "obsolete",
        provider: "missing-provider",
        customSince: "2026-02-30",
        customUntil: "2026-11-10",
        dayOverride: "invalid",
        filters: {
          projects: ["valid", null, 42],
          models: {},
          favorite: "true",
          minCost: -1,
          maxTokens: "500",
          sort: "unknown",
          groupBy: "unknown",
        },
        chartAggregation: "unknown",
        hiddenSessionColumns: ["models", "unknown"],
        selected: { key: "stale-session" },
        update: "invalid-action",
      },
    }),
  );
  const state = createViewStore(storage).getState();
  assert.equal(state.pathname, "/");
  assert.equal(state.range, null);
  assert.equal(state.provider, "all");
  assert.equal(state.customSince, "");
  assert.equal(state.customUntil, "2026-11-10");
  assert.equal(state.dayOverride, null);
  assert.deepEqual(state.filters.projects, ["valid"]);
  assert.deepEqual(state.filters.models, []);
  assert.equal(state.filters.favorite, false);
  assert.equal(state.filters.minCost, null);
  assert.equal(state.filters.maxTokens, null);
  assert.equal(state.filters.sort, defaultQuery.sort);
  assert.equal(state.filters.groupBy, defaultQuery.groupBy);
  assert.equal(state.chartAggregation, "day");
  assert.deepEqual(state.hiddenSessionColumns, ["models"]);
  assert.equal("selected" in state, false);
  assert.equal(typeof state.update, "function");
});

test("denied reads or full storage do not prevent using the current launch", () => {
  const unavailable = () => {
    throw new Error("Storage denied");
  };
  const store = createViewStore({
    getItem: unavailable,
    setItem: unavailable,
    removeItem: unavailable,
  });
  assert.doesNotThrow(() =>
    store.getState().update({ range: "all", pathname: "/models" }),
  );
  assert.equal(store.getState().range, "all");
  assert.equal(store.getState().pathname, "/models");
});

test("dashboard and tray window writes cannot overwrite each other's selections", () => {
  const storage = memoryStorage();
  const dashboard = createViewStore(storage);
  const tray = createTrayViewStore(storage);
  dashboard
    .getState()
    .update({ pathname: "/sessions", provider: "codex", range: "all" });
  tray.getState().update({ provider: "claude" });
  dashboard.getState().update({ chartMetric: "tokens" });
  assert.equal(createViewStore(storage).getState().pathname, "/sessions");
  assert.equal(createViewStore(storage).getState().provider, "codex");
  assert.equal(createTrayViewStore(storage).getState().provider, "claude");
});

test("startup restores the last screen while honoring explicit links and the tray URL", () => {
  assert.equal(
    initialDashboardHash({ hash: "", search: "" }, "/sessions"),
    "#/sessions",
  );
  assert.equal(
    initialDashboardHash({ hash: "", search: "" }, "/settings"),
    "#/settings",
  );
  for (const hash of ["#/", "#/models", "#/sessions?session=explicit"]) {
    assert.equal(initialDashboardHash({ hash, search: "" }, "/projects"), hash);
  }
  assert.equal(
    initialDashboardHash({ hash: "", search: "?window=tray" }, "/sessions"),
    "",
  );
  assert.equal(initialDashboardHash({ hash: "", search: "" }, "/unknown"), "");
});
