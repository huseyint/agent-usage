import { money } from "@/lib/format";
import {
  periodCostDescription,
  unavailablePeriodDescription,
} from "@/lib/costs";

export function PeriodCost({
  value,
  label = "selected period",
  partial = false,
}: {
  value: number | null | undefined;
  label?: string;
  partial?: boolean;
}) {
  const amount = value == null ? "—" : money(value);
  return (
    <span
      className="period-cost"
      title={
        value == null
          ? unavailablePeriodDescription
          : `${amount} for ${label}. ${periodCostDescription}`
      }
      aria-label={`${value == null ? "Unavailable" : amount} for ${label}${partial ? ", plus unpriced usage" : ""}`}
    >
      {amount}
      {partial && " +"}
    </span>
  );
}
