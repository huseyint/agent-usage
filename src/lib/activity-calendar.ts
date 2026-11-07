import { defaultQuery, type DailyUsage } from "./usage-types.ts";

function activityRange(today: string, weekStart: string) {
  const last = new Date(`${today}T12:00:00Z`);
  const weekday = (last.getUTCDay() + (weekStart === "monday" ? 6 : 0)) % 7;
  last.setUTCDate(last.getUTCDate() - ((weekday + 1) % 7));
  const first = new Date(last);
  first.setUTCDate(first.getUTCDate() - (52 * 7 - 1));
  return {
    since: first.toISOString().slice(0, 10),
    until: last.toISOString().slice(0, 10),
  };
}

export function activityQuery(
  today: string,
  providers: string[],
  weekStart: string,
) {
  return {
    ...defaultQuery,
    providers,
    weekStart,
    ...activityRange(today, weekStart),
    limit: 1,
  };
}

export function activityCalendar(
  daily: DailyUsage[],
  today: string,
  weekStart: string,
) {
  const totals = new Map<string, { costMicros: number; tokens: number }>();
  for (const day of daily) {
    const total = totals.get(day.date) || { costMicros: 0, tokens: 0 };
    total.costMicros += day.costMicros;
    total.tokens += day.tokens.total;
    totals.set(day.date, total);
  }
  const range = activityRange(today, weekStart);
  const first = new Date(`${range.since}T12:00:00Z`);
  const last = new Date(`${range.until}T12:00:00Z`);
  const days: {
    date: string;
    column: number;
    row: number;
    costMicros: number;
    tokens: number;
  }[] = [];
  const months: { date: string; label: string; column: number }[] = [];
  for (
    const date = new Date(first);
    date <= last;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10);
    const index = days.length;
    const column = Math.floor(index / 7) + 2;
    if (days.length === 0 || date.getUTCDate() === 1) {
      months.push({
        date: key,
        label: date.toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        }),
        column,
      });
    }
    days.push({
      date: key,
      column,
      row: (index % 7) + 2,
      ...(totals.get(key) || { costMicros: 0, tokens: 0 }),
    });
  }
  const max = Math.max(1, ...days.map((day) => day.costMicros));
  const weekCount = days.length / 7;
  return {
    months: months.filter(
      (month, index) =>
        (months[index + 1]?.column ?? weekCount + 2) - month.column >= 3,
    ),
    weekCount,
    activeDays: days.filter((day) => day.costMicros > 0 || day.tokens > 0)
      .length,
    days: days.map((day) => ({
      ...day,
      level:
        day.costMicros > 0
          ? Math.max(1, Math.ceil((day.costMicros / max) * 4))
          : day.tokens > 0
            ? 1
            : 0,
    })),
  };
}
