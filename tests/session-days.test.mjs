import test from "node:test";
import assert from "node:assert/strict";
import {
  sessionActivityDays,
  sessionFirstUsageDate,
  sessionInPeriod,
} from "../src/lib/session-days.ts";

test("daily usage identifies multi-day sessions when metadata is incomplete", () => {
  assert.deepEqual(
    sessionActivityDays({
      activityDays: [],
      dailyUsage: [{ date: "2026-11-08" }, { date: "2026-11-09" }],
    }),
    ["2026-11-08", "2026-11-09"],
  );
});

test("first usage retains a known date without inventing a timestamp", () => {
  const session = {
    activityDays: [],
    firstActivity: "",
    dailyUsage: [{ date: "2026-11-09" }, { date: "2026-11-08" }],
  };
  assert.equal(sessionFirstUsageDate(session, "America/Chicago"), "2026-11-08");
  assert.equal(
    sessionFirstUsageDate(
      { ...session, dailyUsage: null, firstActivity: "2026-11-09T04:35:38Z" },
      "America/Chicago",
    ),
    "2026-11-08",
  );
  assert.equal(
    sessionFirstUsageDate({ ...session, dailyUsage: null }, "UTC"),
    null,
  );
});

test("date filters use daily usage when metadata is incomplete", () => {
  const session = {
    activityDays: [],
    dailyUsage: [{ date: "2026-11-08" }, { date: "2026-11-09" }],
    lastActivity: "2026-11-10T18:00:00Z",
  };
  for (const day of ["2026-11-08", "2026-11-09"])
    assert.equal(sessionInPeriod(session, day, day, "America/Chicago"), true);
  assert.equal(
    sessionInPeriod(session, "2026-11-10", "2026-11-10", "America/Chicago"),
    false,
  );
  assert.equal(sessionInPeriod(session, null, null, "America/Chicago"), true);
  assert.equal(
    sessionInPeriod(
      { ...session, dailyUsage: null, lastActivity: "2026-11-09T04:35:38Z" },
      "2026-11-08",
      "2026-11-08",
      "America/Chicago",
    ),
    true,
  );
});

test("activity dates combine both sources in order without duplicates", () => {
  const activityDays = ["2026-11-09", "2026-11-07"];
  assert.deepEqual(
    sessionActivityDays({
      activityDays,
      dailyUsage: [{ date: "2026-11-08" }, { date: "2026-11-09" }],
    }),
    ["2026-11-07", "2026-11-08", "2026-11-09"],
  );
  assert.deepEqual(activityDays, ["2026-11-09", "2026-11-07"]);
});

test("older snapshots and single-day sessions retain their known dates", () => {
  assert.deepEqual(sessionActivityDays({ activityDays: [] }), []);
  assert.deepEqual(
    sessionActivityDays({ activityDays: ["2026-11-09"], dailyUsage: null }),
    ["2026-11-09"],
  );
  assert.deepEqual(
    sessionActivityDays({
      activityDays: ["2026-11-09"],
      dailyUsage: [{ date: "2026-11-09" }],
    }),
    ["2026-11-09"],
  );
});
