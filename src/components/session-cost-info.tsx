import { displayDate, money } from "@/lib/format";
import { sessionActivityDays } from "@/lib/session-days";
import type { Session } from "@/lib/usage-types";
import { UIcon } from "./usage-icon";

export function SessionCostInfo({ session }: { session: Session }) {
  const days = sessionActivityDays(session);
  if (days.length < 2) return null;

  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const description = `This session spans ${days.length} active days (${displayDate(days[0], dateOptions)} – ${displayDate(days.at(-1)!, dateOptions)}). ${session.periodCostMicros == null ? "The cost for the selected dates is unavailable." : "The cost shown includes only usage within the selected dates."} Session total across all dates: ${money(session.costMicros)}${session.missingPricing ? " plus unpriced usage" : ""} (estimated).`;

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
