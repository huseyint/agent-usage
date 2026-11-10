import { displayDate, money } from "@/lib/format";
import { sessionActivityDays } from "@/lib/session-days";
import type { Session } from "@/lib/usage-types";
import { UIcon } from "./usage-icon";

export function SessionCostInfo({
  session,
  value,
  label,
}: {
  session: Session;
  value: number | null;
  label: string;
}) {
  const days = sessionActivityDays(session);
  if (days.length < 2) return null;

  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const description = `This session spans ${days.length} active days (${displayDate(days[0], dateOptions)} – ${displayDate(days.at(-1)!, dateOptions)}). ${value == null ? `The cost for ${label} is unavailable.` : `The first amount includes only usage for ${label} and is used in group totals.`} The amount in parentheses is the session total across all dates: ${money(session.costMicros)}${session.missingPricing ? " plus unpriced usage" : ""} (estimated).`;

  return (
    <span
      className="session-cost-info"
      title={description}
      aria-label={description}
      role="img"
      tabIndex={0}
    >
      <UIcon name="info" size={13} />
    </span>
  );
}
