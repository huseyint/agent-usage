import type { Session } from "./usage-types.ts";
import { dateKey } from "./format.ts";

export function sessionActivityDays(
  session: Pick<Session, "activityDays" | "dailyUsage">,
): string[] {
  return [
    ...new Set([
      ...session.activityDays,
      ...(session.dailyUsage?.map((day) => day.date) ?? []),
    ]),
  ].sort();
}

export function sessionFirstUsageDate(
  session: Pick<Session, "activityDays" | "dailyUsage" | "firstActivity">,
  timezone: string,
): string | null {
  const days = sessionActivityDays(session);
  if (session.firstActivity)
    days.push(dateKey(new Date(session.firstActivity), timezone));
  return days.sort()[0] ?? null;
}

export function sessionInPeriod(
  session: Pick<Session, "activityDays" | "dailyUsage" | "lastActivity">,
  since: string | null,
  until: string | null,
  timezone: string,
): boolean {
  const days = sessionActivityDays(session);
  if (!days.length && session.lastActivity)
    days.push(dateKey(new Date(session.lastActivity), timezone));
  return days.some(
    (day) => (!since || day >= since) && (!until || day <= until),
  );
}
