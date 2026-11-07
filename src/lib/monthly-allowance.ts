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
