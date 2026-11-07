import { infiniteQueryOptions } from "@tanstack/react-query";
import type { Query, ViewData } from "./usage-types";

export function sessionQueryOptions(
  query: Query,
  fetchView: (query: Query) => Promise<ViewData>,
) {
  return infiniteQueryOptions({
    queryKey: ["usage", "sessions", query],
    queryFn: ({ pageParam }) => fetchView({ ...query, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, offset) => {
      const next = offset + lastPage.sessions.length;
      return lastPage.sessions.length && next < lastPage.sessionCount
        ? next
        : undefined;
    },
    select: (data): ViewData => ({
      ...data.pages[0],
      sessions: data.pages.flatMap((page) => page.sessions),
    }),
  });
}
