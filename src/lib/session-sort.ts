import type { Query } from "./usage-types";

export type SessionSortColumn =
  "last" | "name" | "provider" | "project" | "tokens" | "cost" | "periodCost";

export function sessionColumnSort(
  query: Pick<Query, "sort" | "descending" | "groupBy">,
  column: SessionSortColumn,
) {
  const numeric =
    column === "tokens" || column === "cost" || column === "periodCost";
  return {
    sort: column,
    descending:
      query.sort === column ? !query.descending : numeric || column === "last",
    groupBy: numeric ? "none" : query.groupBy,
  };
}

export function groupsFollowLastActivity(
  query: Pick<Query, "sort" | "groupBy">,
) {
  return (
    query.sort === "last" && ["day", "week", "month"].includes(query.groupBy)
  );
}

export function sessionGroupsDescending(
  query: Pick<Query, "sort" | "groupBy" | "descending" | "descendingGroups">,
) {
  return groupsFollowLastActivity(query)
    ? query.descending
    : query.descendingGroups;
}
