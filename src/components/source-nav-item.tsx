import { useEffect, useId, useState } from "react";
import { NavLink } from "react-router";
import { useUsage } from "@/lib/usage-context";
import { costDescription, money } from "@/lib/format";
import { monthlyProviderSpend } from "@/lib/monthly-allowance";
import type { Provider } from "@/lib/usage-types";
import { ProviderMark } from "./usage-icon";

export function SourceNavItem({
  provider,
  ready,
  allowance,
}: {
  provider: Provider;
  ready: boolean;
  allowance: number | null;
}) {
  const { monthlyUsage, bootstrap } = useUsage();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const label = provider === "claude" ? "Claude Code" : "Codex";
  const hasAllowance = allowance != null && allowance > 0;
  const available = !!monthlyUsage.data && !!bootstrap.data?.hasSnapshot;
  const { costMicros, missingPricing } = monthlyProviderSpend(
    available ? monthlyUsage.data!.daily : [],
    provider,
  );
  const spend = costMicros / 1e6;
  const percentage = hasAllowance
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format((spend / allowance) * 100)}%`
    : "";
  const cached = monthlyUsage.data?.stale || monthlyUsage.isError;
  const status = monthlyUsage.isError
    ? "Monthly spend unavailable"
    : bootstrap.data?.hasSnapshot
      ? "Loading monthly spend…"
      : "Refresh to see monthly spend";
  const sourceStatus = ready ? "Readable local source" : "Source not detected";

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  return (
    <div
      className="source-nav-item"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <NavLink
        to="/settings"
        className={`source-nav-row ${hasAllowance ? "has-allowance" : ""}`}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen(false)}
      >
        <ProviderMark provider={provider} />
        <span className="source-nav-name">{label}</span>
        <span className={`status-dot ${ready ? "ok" : ""}`} />
        {hasAllowance && (
          <progress
            className="source-allowance"
            max={allowance}
            value={Math.min(spend, allowance)}
            aria-label={`${label} monthly allowance`}
            aria-valuetext={
              available
                ? `${money(costMicros)} spent of ${money(allowance * 1e6)} USD (${percentage} used)${missingPricing ? "; incomplete pricing" : ""}${cached ? "; cached snapshot" : ""}`
                : status
            }
          />
        )}
      </NavLink>
      {open && (
        <div id={tooltipId} role="tooltip" className="source-tooltip">
          <header>
            <ProviderMark provider={provider} label />
            {hasAllowance && <span>This month · USD</span>}
          </header>
          {hasAllowance && (
            <>
              {available ? (
                <>
                  <div className="source-tooltip-spend">
                    <strong>
                      {money(costMicros)}
                      {missingPricing ? " +" : ""}
                    </strong>
                    <span>Estimated spend</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Monthly allowance</dt>
                      <dd>{money(allowance * 1e6)}</dd>
                    </div>
                    <div>
                      <dt>Used</dt>
                      <dd>{percentage}</dd>
                    </div>
                    <div>
                      <dt>
                        {spend > allowance ? "Over allowance" : "Remaining"}
                      </dt>
                      <dd>{money(Math.abs(allowance * 1e6 - costMicros))}</dd>
                    </div>
                  </dl>
                  {missingPricing && (
                    <p className="source-tooltip-notice">
                      Some usage has no pricing. Spend is incomplete.
                    </p>
                  )}
                  {cached && (
                    <p className="source-tooltip-notice">
                      Cached snapshot. Refresh to update.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <dl>
                    <div>
                      <dt>Monthly allowance</dt>
                      <dd>{money(allowance * 1e6)}</dd>
                    </div>
                  </dl>
                  <p className="source-tooltip-notice">{status}</p>
                </>
              )}
              <p className="source-tooltip-note">{costDescription}</p>
            </>
          )}
          <div className="source-tooltip-status">
            <span className={`status-dot ${ready ? "ok" : ""}`} />
            {sourceStatus}
          </div>
        </div>
      )}
    </div>
  );
}
