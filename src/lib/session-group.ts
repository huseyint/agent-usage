import { dateKey } from "./format.ts";
import type { Query, Session } from "./usage-types.ts";

type GroupQuery = Pick<Query, "groupBy" | "weekStart" | "since" | "until">;

export function sessionGroupKey(
  session: Pick<Session, "lastActivity" | "projectPath" | "provider">,
  query: Pick<Query, "groupBy" | "weekStart">,
  timezone: string,
): string {
  if (query.groupBy === "project") return session.projectPath;
  if (query.groupBy === "provider") return session.provider;
  if (query.groupBy === "none") return "All sessions";
  const day = dateKey(new Date(session.lastActivity), timezone);
  if (query.groupBy === "month") return day.slice(0, 7);
  if (query.groupBy === "week") {
    const date = new Date(`${day}T12:00:00Z`);
    const offset =
      query.weekStart === "sunday"
        ? date.getUTCDay()
        : (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }
  return day;
}

export function sessionGroupPeriod(
  session: Pick<Session, "lastActivity" | "projectPath" | "provider">,
  query: GroupQuery,
  timezone: string,
): [string | null, string | null] {
  if (!["day", "week", "month"].includes(query.groupBy))
    return [query.since, query.until];
  const key = sessionGroupKey(session, query, timezone);
  const since = query.groupBy === "month" ? `${key}-01` : key;
  const end = new Date(`${since}T12:00:00Z`);
  if (query.groupBy === "week") end.setUTCDate(end.getUTCDate() + 6);
  if (query.groupBy === "month") end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const until = end.toISOString().slice(0, 10);
  return [
    query.since && query.since > since ? query.since : since,
    query.until && query.until < until ? query.until : until,
  ];
}
