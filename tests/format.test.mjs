import test from "node:test";
import assert from "node:assert/strict";
import { dateKey, rangeDates, money } from "../src/lib/format.ts";
test("dates use chosen timezone around a DST transition", () => {
  assert.equal(
    dateKey(new Date("2026-11-01T05:30:00Z"), "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(
    dateKey(new Date("2026-03-08T05:59:00Z"), "America/Chicago"),
    "2026-03-07",
  );
  assert.equal(
    dateKey(new Date("2026-03-08T08:00:00Z"), "America/Chicago"),
    "2026-03-08",
  );
});
test("money retains sub-cent visibility and display rounding", () => {
  assert.equal(money(1000000), "$1.00");
  assert.equal(money(614), "$0.000614");
  assert.equal(money(1234567), "$1.23");
});
test("custom and all-time intervals preserve explicit boundaries", () => {
  assert.deepEqual(rangeDates("custom", "UTC", "2026-02-01", "2026-03-01"), [
    "2026-02-01",
    "2026-03-01",
  ]);
  assert.deepEqual(rangeDates("all", "UTC", "", ""), [null, null]);
});
