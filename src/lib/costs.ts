import type { Session } from "./usage-types.ts";

export const periodCostDescription =
  "Estimated API-equivalent cost of usage recorded within the selected dates. Copied session history is counted once. Not a subscription charge.";
export const lifetimeCostDescription =
  "Estimated API-equivalent cost across all dates for this session, including usage outside the selected period. Not a subscription charge.";
export const unavailablePeriodDescription =
  "Period usage is unavailable in this cached snapshot. Refresh with the bundled engine to load per-session daily usage.";

export function sessionPeriodCost(
  session: Session,
  since: string | null,
  until: string | null,
): number | null {
  const matches = (date: string) =>
    (!since || date >= since) && (!until || date <= until);
  if (session.dailyUsage != null)
    return session.dailyUsage
      .filter((day) => matches(day.date))
      .reduce((sum, day) => sum + day.costMicros, 0);
  if (
    (!since && !until) ||
    (session.activityDays.length > 0 && session.activityDays.every(matches))
  )
    return session.costMicros;
  if (session.activityDays.length && !session.activityDays.some(matches))
    return 0;
  return null;
}

export function sessionModelPeriodCost(
  session: Session,
  model: string,
  since: string | null,
  until: string | null,
): number | null {
  if (session.dailyUsage != null)
    return session.dailyUsage
      .filter(
        (day) => (!since || day.date >= since) && (!until || day.date <= until),
      )
      .flatMap((day) => day.models)
      .filter((usage) => usage.model === model)
      .reduce((sum, usage) => sum + usage.costMicros, 0);
  const period = sessionPeriodCost(session, since, until);
  return period === session.costMicros
    ? (session.models.find((usage) => usage.model === model)?.costMicros ?? 0)
    : period === 0
      ? 0
      : null;
}
