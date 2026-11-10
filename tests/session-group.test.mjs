import test from "node:test";
import assert from "node:assert/strict";
import {
  sessionGroupKey,
  sessionGroupPeriod,
} from "../src/lib/session-group.ts";
import { sessionPeriodCost, sessionModelPeriodCost } from "../src/lib/costs.ts";

const session = {
  lastActivity: "2026-11-09T18:00:00Z",
  projectPath: "/project",
  provider: "codex",
  activityDays: [],
  costMicros: 10_000_000,
  dailyUsage: ["2026-10-31", "2026-11-01", "2026-11-08", "2026-11-09"].map(
    (date, i) => ({
      date,
      costMicros: (i + 1) * 1_000_000,
      models: [{ model: "model", costMicros: (i + 1) * 1_000_000 }],
    }),
  ),
};
const query = {
  groupBy: "day",
  weekStart: "monday",
  since: "2026-10-31",
  until: "2026-11-09",
};

test("calendar rows use their group bucket rather than the whole date filter", () => {
  for (const [groupBy, weekStart, expected] of [
    ["day", "monday", 4_000_000],
    ["week", "monday", 4_000_000],
    ["week", "sunday", 7_000_000],
    ["month", "monday", 9_000_000],
    ["project", "monday", 10_000_000],
    ["provider", "monday", 10_000_000],
    ["none", "monday", 10_000_000],
  ]) {
    const [since, until] = sessionGroupPeriod(
      session,
      { ...query, groupBy, weekStart },
      "America/Chicago",
    );
    assert.equal(sessionPeriodCost(session, since, until), expected);
    assert.equal(
      sessionModelPeriodCost(session, "model", since, until),
      expected,
    );
    assert.equal(session.costMicros, 10_000_000);
  }
});

test("group periods intersect the selected dates and respect display timezone", () => {
  assert.deepEqual(
    sessionGroupPeriod(
      session,
      { ...query, groupBy: "month", since: "2026-11-08" },
      "America/Chicago",
    ),
    ["2026-11-08", "2026-11-09"],
  );
  const midnight = { ...session, lastActivity: "2026-11-09T04:00:00Z" };
  assert.equal(
    sessionGroupKey(midnight, query, "America/Chicago"),
    "2026-11-08",
  );
  assert.deepEqual(sessionGroupPeriod(midnight, query, "America/Chicago"), [
    "2026-11-08",
    "2026-11-08",
  ]);
  assert.deepEqual(
    sessionGroupPeriod(
      { ...session, lastActivity: "2027-01-01T18:00:00Z" },
      { ...query, groupBy: "month", since: null, until: null },
      "UTC",
    ),
    ["2027-01-01", "2027-01-31"],
  );
  assert.deepEqual(
    sessionGroupPeriod(
      { ...session, lastActivity: "2028-02-29T18:00:00Z" },
      { ...query, groupBy: "month", since: null, until: null },
      "UTC",
    ),
    ["2028-02-01", "2028-02-29"],
  );
});

test("legacy multi-day sessions do not substitute total cost for unknown group cost", () => {
  const [since, until] = sessionGroupPeriod(session, query, "America/Chicago");
  assert.equal(
    sessionPeriodCost(
      {
        ...session,
        dailyUsage: null,
        activityDays: ["2026-11-08", "2026-11-09"],
      },
      since,
      until,
    ),
    null,
  );
});
