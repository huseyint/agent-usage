import test from "node:test";
import assert from "node:assert/strict";
import {
  activityCalendar,
  activityQuery,
} from "../src/lib/activity-calendar.ts";

test("activity queries fetch 52 full weeks through the latest week end and retain provider filters", () => {
  const monday = activityQuery("2026-11-07", ["codex"], "monday");
  assert.equal(monday.since, "2025-11-03");
  assert.equal(monday.until, "2026-11-01");
  assert.deepEqual(monday.providers, ["codex"]);
  assert.equal(monday.weekStart, "monday");
  const sunday = activityQuery("2026-11-07", [], "sunday");
  assert.equal(sunday.since, "2025-11-09");
  assert.equal(sunday.until, "2026-11-07");
});

test("every column has seven aligned dates for either week start across leap years and year boundaries", () => {
  for (const anchor of [
    "2024-02-26",
    "2026-01-01",
    "2026-11-01",
    "2028-12-25",
  ]) {
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(`${anchor}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const today = date.toISOString().slice(0, 10);
      for (const weekStart of ["sunday", "monday"]) {
        const query = activityQuery(today, [], weekStart);
        const calendar = activityCalendar([], today, weekStart);
        assert.equal(calendar.weekCount, 52);
        assert.equal(calendar.days.length, 364);
        assert.equal(calendar.days[0].date, query.since);
        assert.equal(calendar.days.at(-1).date, query.until);
        assert.equal(new Set(calendar.days.map((day) => day.date)).size, 364);
        const columns = new Map();
        for (const [index, day] of calendar.days.entries()) {
          assert.ok(day.date <= today);
          const timestamp = Date.parse(`${day.date}T12:00:00Z`);
          if (index)
            assert.equal(
              timestamp -
                Date.parse(`${calendar.days[index - 1].date}T12:00:00Z`),
              86400000,
            );
          const weekday = new Date(timestamp).getUTCDay();
          const row = (weekday + (weekStart === "monday" ? 6 : 0)) % 7;
          assert.equal(day.row, row + 2);
          const rows = columns.get(day.column) || [];
          rows.push(day.row);
          columns.set(day.column, rows);
        }
        assert.equal(columns.size, 52);
        for (const rows of columns.values())
          assert.deepEqual(rows, [2, 3, 4, 5, 6, 7, 8]);
        for (const [index, month] of calendar.months.entries()) {
          assert.equal(
            month.column,
            calendar.days.find((day) => day.date === month.date).column,
          );
          assert.ok(month.column + 2 <= calendar.weekCount + 1);
          if (index)
            assert.ok(month.column - calendar.months[index - 1].column >= 3);
        }
      }
    }
  }
});

test("the range advances only when another complete week is available", () => {
  for (const weekStart of ["sunday", "monday"]) {
    const lastDay = weekStart === "monday" ? "2026-11-08" : "2026-11-07";
    const nextDay = weekStart === "monday" ? "2026-11-09" : "2026-11-08";
    const previousDay = weekStart === "monday" ? "2026-11-07" : "2026-11-06";
    const complete = activityQuery(lastDay, [], weekStart);
    assert.equal(complete.until, lastDay);
    assert.deepEqual(activityQuery(nextDay, [], weekStart), complete);
    assert.equal(
      Date.parse(complete.until) -
        Date.parse(activityQuery(previousDay, [], weekStart).until),
      7 * 86400000,
    );
  }
  assert.ok(
    activityCalendar([], "2024-03-03", "monday").days.some(
      (day) => day.date === "2024-02-29",
    ),
  );
});

test("activity sums providers and uses five levels, excluding days outside the full weeks", () => {
  const entry = (date, provider, costMicros, total = 1) => ({
    date,
    provider,
    costMicros,
    tokens: { total },
  });
  const calendar = activityCalendar(
    [
      entry("2025-11-03", "claude", 1),
      entry("2025-11-03", "codex", 1),
      entry("2025-11-04", "claude", 4),
      entry("2025-11-05", "codex", 6),
      entry("2025-11-06", "codex", 8),
      entry("2025-11-07", "codex", 0),
      entry("2025-11-02", "codex", 1000),
      entry("2026-11-02", "codex", 1000),
      entry("2026-11-08", "codex", 1000),
    ],
    "2026-11-07",
    "monday",
  );
  assert.deepEqual(
    calendar.days.slice(0, 6).map((day) => day.level),
    [1, 2, 3, 4, 1, 0],
  );
  assert.equal(calendar.days[0].costMicros, 2);
  assert.equal(calendar.days[0].tokens, 2);
  assert.equal(calendar.activeDays, 5);
  assert.equal(activityCalendar([], "2026-11-07", "monday").activeDays, 0);
});
