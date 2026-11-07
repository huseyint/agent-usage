import test from "node:test";
import assert from "node:assert/strict";
import { activityStatus } from "../src/lib/session-activity.ts";
const now = Date.parse("2026-11-06T20:00:00Z");
const working = {
  state: "working",
  observedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 120_000).toISOString(),
};
test("liveness expires even if the last successful result remains cached", () => {
  assert.equal(activityStatus(working, now), "working");
  assert.equal(activityStatus(working, now + 120_000), undefined);
  assert.equal(activityStatus({ ...working, state: "recent" }, now), "recent");
});
test("missing, malformed, future and unsupported status data do not show liveness", () => {
  assert.equal(activityStatus(undefined, now), undefined);
  assert.equal(
    activityStatus({ ...working, expiresAt: "invalid" }, now),
    undefined,
  );
  assert.equal(
    activityStatus(
      { ...working, observedAt: new Date(now + 60_000).toISOString() },
      now,
    ),
    undefined,
  );
  assert.equal(
    activityStatus({ ...working, state: "unknown" }, now),
    undefined,
  );
});
