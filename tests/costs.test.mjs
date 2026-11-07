import test from "node:test";
import assert from "node:assert/strict";
import { sessionPeriodCost, sessionModelPeriodCost } from "../src/lib/costs.ts";

const session = {
  costMicros: 5_000_000,
  activityDays: ["2026-11-07", "2026-11-08"],
  models: [{ model: "model", costMicros: 5_000_000 }],
  dailyUsage: [
    {
      date: "2026-11-07",
      costMicros: 2_000_000,
      models: [{ model: "model", costMicros: 2_000_000 }],
    },
    {
      date: "2026-11-08",
      costMicros: 3_000_000,
      models: [{ model: "model", costMicros: 3_000_000 }],
    },
  ],
};

test("period costs use inclusive event dates and keep session lifetime intact", () => {
  assert.equal(
    sessionPeriodCost(session, "2026-11-08", "2026-11-08"),
    3_000_000,
  );
  assert.equal(
    sessionModelPeriodCost(session, "model", "2026-11-08", "2026-11-08"),
    3_000_000,
  );
  assert.equal(sessionPeriodCost(session, null, null), 5_000_000);
  assert.equal(sessionPeriodCost(session, null, "2026-11-07"), 2_000_000);
  assert.equal(sessionPeriodCost(session, "2026-11-09", null), 0);
  assert.equal(session.costMicros, 5_000_000);
});

test("a recent session with no usage today shows zero rather than lifetime", () => {
  assert.equal(sessionPeriodCost(session, "2026-11-09", "2026-11-09"), 0);
  assert.equal(sessionModelPeriodCost(session, "other", null, null), 0);
  assert.equal(
    sessionPeriodCost({ ...session, dailyUsage: [] }, null, null),
    0,
  );
});

test("older snapshots never fabricate a partial-period cost", () => {
  const legacy = { ...session, dailyUsage: null };
  assert.equal(sessionPeriodCost(legacy, "2026-11-08", "2026-11-08"), null);
  assert.equal(
    sessionModelPeriodCost(legacy, "model", "2026-11-08", "2026-11-08"),
    null,
  );
  assert.equal(
    sessionPeriodCost(legacy, "2026-11-07", "2026-11-08"),
    5_000_000,
  );
  assert.equal(sessionPeriodCost(legacy, "2026-11-09", null), 0);
});
