import { queryOptions } from "@tanstack/react-query";
import { dateKey } from "./format.ts";
import {
  defaultQuery,
  type Provider,
  type Query,
  type ViewData,
} from "./usage-types.ts";

type FetchView = (query: Query) => Promise<ViewData>;

// Recent means latest activity across all dates, including quiet days/weekends.
export function trayRecentOptions(
  provider: "all" | Provider,
  fetchView: FetchView,
) {
  return queryOptions({
    queryKey: ["tray-recent", provider],
    queryFn: () =>
      fetchView({
        ...defaultQuery,
        providers: provider === "all" ? [] : [provider],
        since: null,
        until: null,
        sort: "last",
        descending: true,
        groupBy: "none",
        limit: 8,
      }),
  });
}

export function trayTodayOptions(
  now: number,
  timezone: string,
  fetchView: FetchView,
) {
  const today = dateKey(new Date(now), timezone);
  return queryOptions({
    queryKey: ["tray-today", timezone, today],
    queryFn: () =>
      fetchView({ ...defaultQuery, since: today, until: today, limit: 1 }),
  });
}
