import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { millisecondsUntilNextDay } from "../src/lib/day-clock.ts";
import {
  trayRecentOptions,
  trayTodayOptions,
} from "../src/lib/tray-queries.ts";

const zone = "America/Chicago";
test("today changes at configured midnight, independently of recent sessions", async () => {
  const queries = [];
  const fetchView = async (q) => {
    queries.push(q);
    return { sessions: [] };
  };
  const before = trayTodayOptions(
    Date.parse("2026-11-07T05:59:59Z"),
    zone,
    fetchView,
  );
  const after = trayTodayOptions(
    Date.parse("2026-11-07T06:00:00Z"),
    zone,
    fetchView,
  );
  assert.deepEqual(before.queryKey, ["tray-today", zone, "2026-11-06"]);
  assert.deepEqual(after.queryKey, ["tray-today", zone, "2026-11-07"]);
  await before.queryFn();
  await after.queryFn();
  assert.equal(queries[0].since, "2026-11-06");
  assert.equal(queries[1].since, "2026-11-07");
  assert.equal(queries[1].until, "2026-11-07");
  assert.equal(
    millisecondsUntilNextDay(Date.parse("2026-11-07T05:59:59Z"), zone),
    1000,
  );
});

test("calendar timer respects short and long daylight-saving days", () => {
  assert.equal(
    millisecondsUntilNextDay(Date.parse("2026-03-08T06:00:00Z"), zone),
    23 * 3600_000,
  );
  assert.equal(
    millisecondsUntilNextDay(Date.parse("2026-11-01T05:00:00Z"), zone),
    25 * 3600_000,
  );
  assert.equal(
    millisecondsUntilNextDay(Date.parse("2026-11-07T00:00:00Z"), "UTC"),
    24 * 3600_000,
  );
});

test("changing timezone isolates today's cached totals even on the same date", () => {
  const now = Date.parse("2026-11-06T18:00:00Z");
  const fetchView = async () => ({});
  assert.notDeepEqual(
    trayTodayOptions(now, zone, fetchView).queryKey,
    trayTodayOptions(now, "UTC", fetchView).queryKey,
  );
});

test("recent queries are unbounded and retain provider filtering across quiet days", async () => {
  for (const provider of ["all", "claude", "codex"]) {
    let query;
    await trayRecentOptions(provider, async (q) => {
      query = q;
      return {};
    }).queryFn();
    assert.equal(query.since, null);
    assert.equal(query.until, null);
    assert.equal(query.sort, "last");
    assert.equal(query.descending, true);
    assert.equal(query.groupBy, "none");
    assert.equal(query.limit, 8);
    assert.deepEqual(query.providers, provider === "all" ? [] : [provider]);
  }
});

test("yesterday's in-flight totals cannot overwrite the new day's empty totals", async (t) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let finishYesterday;
  const fetchView = (q) =>
    q.since === "2026-11-06"
      ? new Promise((resolve) => {
          finishYesterday = resolve;
        })
      : Promise.resolve({ summary: { costMicros: 0 }, sessions: [] });
  const old = trayTodayOptions(
    Date.parse("2026-11-07T05:59:59Z"),
    zone,
    fetchView,
  );
  const current = trayTodayOptions(
    Date.parse("2026-11-07T06:00:00Z"),
    zone,
    fetchView,
  );
  const observer = new QueryObserver(client, old);
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.clear();
  });
  observer.setOptions(current);
  await observer.refetch();
  finishYesterday({ summary: { costMicros: 1000000 }, sessions: [] });
  await client.fetchQuery(old);
  assert.equal(observer.getCurrentResult().data.summary.costMicros, 0);
});
