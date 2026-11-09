import { queryOptions } from "@tanstack/react-query";
import {
  defaultQuery,
  type DailyUsage,
  type Provider,
  type Query,
  type ViewData,
} from "./usage-types.ts";

export function monthlyAllowanceOptions(
  today: string,
  timezone: string,
  fetchView: (query: Query) => Promise<ViewData>,
) {
  return queryOptions({
    queryKey: ["usage", "monthly-allowance", timezone, today],
    queryFn: () =>
      fetchView({
        ...defaultQuery,
        since: `${today.slice(0, 7)}-01`,
        until: today,
        limit: 1,
      }),
  });
}

export function monthlyProviderSpend(daily: DailyUsage[], provider: Provider) {
  const days = daily.filter((day) => day.provider === provider);
  return {
    costMicros: days.reduce((sum, day) => sum + day.costMicros, 0),
    missingPricing: days.some((day) => day.missingPricing),
  };
}

export function validMonthlyAllowance(value: number | null | undefined) {
  return value == null || (Number.isFinite(value) && value > 0);
}

export function monthlyAllowancePace(
  today: string,
  spend: number,
  allowance: number,
) {
  const [year, month, day] = today.split("-").map(Number);
  // Match the month-to-date query: include today in the display timezone.
  const monthFraction = day / new Date(Date.UTC(year, month, 0)).getUTCDate();
  const usedFraction = spend / allowance;
  // Avoid switching states for tiny differences around the calendar marker.
  const difference = usedFraction - monthFraction;
  const state =
    usedFraction >= 1
      ? "exhausted"
      : Math.abs(difference) <= 0.02 + Number.EPSILON
        ? "on-pace"
        : difference > 0
          ? "above-pace"
          : "below-pace";
  const label =
    state === "exhausted"
      ? usedFraction > 1
        ? "Over allowance"
        : "Allowance reached"
      : state === "on-pace"
        ? "On pace"
        : state === "above-pace"
          ? "Above pace"
          : "Below pace";
  return { monthFraction, state, label };
}
