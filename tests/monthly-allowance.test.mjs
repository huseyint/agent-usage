import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  monthlyAllowanceOptions,
  monthlyAllowancePace,
  monthlyProviderSpend,
  validMonthlyAllowance,
} from "../src/lib/monthly-allowance.ts";

test("pace compares allowance used with the current calendar day", () => {
  assert.deepEqual(monthlyAllowancePace("2026-11-15", 30, 100), {
    monthFraction: 0.5,
    state: "below-pace",
    label: "Below pace",
  });
  assert.equal(monthlyAllowancePace("2026-11-15", 50, 100).state, "on-pace");
  assert.equal(monthlyAllowancePace("2026-11-15", 75, 100).state, "above-pace");
  assert.equal(monthlyAllowancePace("2026-11-15", 0, 100).state, "below-pace");
  for (const spend of [48, 52])
    assert.equal(
      monthlyAllowancePace("2026-11-15", spend, 100).state,
      "on-pace",
    );
  assert.equal(
    monthlyAllowancePace("2026-11-15", 47.9, 100).state,
    "below-pace",
  );
  assert.equal(
    monthlyAllowancePace("2026-11-15", 52.1, 100).state,
    "above-pace",
  );
});

test("pace includes today and handles different month lengths and leap years", () => {
  for (const [date, days] of [
    ["2026-02-14", 28],
    ["2028-02-14", 29],
    ["2026-11-14", 30],
    ["2026-12-14", 31],
  ]) {
    assert.equal(monthlyAllowancePace(date, 0, 100).monthFraction, 14 / days);
  }
  assert.equal(monthlyAllowancePace("2026-12-31", 50, 100).monthFraction, 1);
  assert.equal(
    monthlyAllowancePace("2027-01-01", 0, 100).monthFraction,
    1 / 31,
  );
});

test("reaching the allowance takes precedence over pace, including month end", () => {
  for (const today of ["2026-11-01", "2026-11-15", "2026-11-30"]) {
    assert.equal(monthlyAllowancePace(today, 100, 100).state, "exhausted");
    assert.equal(
      monthlyAllowancePace(today, 100, 100).label,
      "Allowance reached",
    );
    assert.equal(monthlyAllowancePace(today, 125, 100).state, "exhausted");
    assert.equal(monthlyAllowancePace(today, 125, 100).label, "Over allowance");
  }
});

test("month-to-date totals query all providers without report filters", async () => {
  let query;
  await monthlyAllowanceOptions("2026-11-07", "America/Chicago", async (q) => {
    query = q;
  }).queryFn();
  assert.equal(query.since, "2026-11-01");
  assert.equal(query.until, "2026-11-07");
  assert.deepEqual(query.providers, []);
  assert.deepEqual(query.projects, []);
  assert.deepEqual(query.models, []);
  assert.equal(query.search, "");
  assert.equal(query.favorite, false);
});

test("spend uses daily provider amounts, including incomplete pricing and empty months", () => {
  const daily = [
    { provider: "claude", costMicros: 20_000_000, missingPricing: false },
    { provider: "codex", costMicros: 90_000_000, missingPricing: false },
    { provider: "claude", costMicros: 30_000_000, missingPricing: true },
  ];
  assert.deepEqual(monthlyProviderSpend(daily, "claude"), {
    costMicros: 50_000_000,
    missingPricing: true,
  });
  assert.deepEqual(monthlyProviderSpend(daily, "codex"), {
    costMicros: 90_000_000,
    missingPricing: false,
  });
  assert.deepEqual(monthlyProviderSpend([], "codex"), {
    costMicros: 0,
    missingPricing: false,
  });
});

test("allowances can be unset or positive, and reject invalid amounts", () => {
  for (const amount of [null, undefined, 0.01, 100, 150.5])
    assert.equal(validMonthlyAllowance(amount), true);
  for (const amount of [0, -1, NaN, Infinity, -Infinity])
    assert.equal(validMonthlyAllowance(amount), false);
});

test("timezone and calendar boundaries isolate monthly totals in the cache", () => {
  const query = (day, zone) =>
    monthlyAllowanceOptions(day, zone, async () => ({}));
  assert.notDeepEqual(
    query("2026-11-01", "UTC").queryKey,
    query("2026-11-01", "America/Chicago").queryKey,
  );
  assert.notDeepEqual(
    query("2026-11-30", "UTC").queryKey,
    query("2026-12-01", "UTC").queryKey,
  );
});

test("late previous-month responses cannot overwrite a new month's empty spend", async (t) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let finishPrevious;
  const fetchView = (q) =>
    q.since === "2026-11-01"
      ? new Promise((resolve) => {
          finishPrevious = resolve;
        })
      : Promise.resolve({ daily: [] });
  const previous = monthlyAllowanceOptions("2026-11-30", "UTC", fetchView);
  const current = monthlyAllowanceOptions("2026-12-01", "UTC", fetchView);
  const observer = new QueryObserver(client, previous);
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.clear();
  });
  observer.setOptions(current);
  await observer.refetch();
  finishPrevious({ daily: [{ provider: "claude", costMicros: 100_000_000 }] });
  await client.fetchQuery(previous);
  assert.deepEqual(observer.getCurrentResult().data.daily, []);
  // The normal app refresh also invalidates the sidebar's monthly query.
  await client.invalidateQueries({ queryKey: ["usage"], refetchType: "none" });
  assert.equal(client.getQueryState(current.queryKey).isInvalidated, true);
});
