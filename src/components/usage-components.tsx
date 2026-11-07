import { bucketDaily, type Bucket } from "@/lib/chart-data";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useUsage } from "@/lib/usage-context";
import { usageApi, errorMessage } from "@/lib/usage-api";
import { compact, costDescription, displayDate, money } from "@/lib/format";
import type { DailyUsage } from "@/lib/usage-types";
import { isDesktop } from "@/lib/desktop";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { UIcon, ProviderMark } from "./usage-icon";
import { PopupMenu } from "./popup-menu";
import { PeriodCost } from "./period-cost";
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function DataBoundary({ children }: { children: ReactNode }) {
  const u = useUsage();
  const navigate = useNavigate();
  if (u.bootstrap.isPending)
    return (
      <div className="loading-state">
        <UIcon name="refresh" className="spinning" />
        Opening your local workspace…
      </div>
    );
  if (!u.bootstrap.data || u.bootstrap.isError)
    return (
      <div className="empty-feature">
        <UIcon name="info" size={30} />
        <h2>Workspace unavailable</h2>
        <p>{errorMessage(u.bootstrap.error)}</p>
        <button
          className="primary-button"
          onClick={() => void u.bootstrap.refetch()}
        >
          Try again
        </button>
      </div>
    );
  if (!u.bootstrap.data.hasSnapshot)
    return (
      <div className="empty-feature">
        <div className="empty-feature-icon">
          <UIcon name="activity" size={32} />
        </div>
        <h2>No usage data yet</h2>
        <p>
          Connect your Claude Code and Codex logs to explore session names,
          recorded tokens, and estimated API-equivalent costs.
        </p>
        {u.bootstrap.data.lastError && (
          <p className="warning-text">{u.bootstrap.data.lastError.message}</p>
        )}
        <div className="button-row">
          <button
            className="primary-button"
            onClick={() => u.refresh.mutate()}
            disabled={u.refresh.isPending}
          >
            {u.refresh.isPending
              ? "Reading local sources…"
              : "Scan local sources"}
            <UIcon name="arrow" size={16} />
          </button>
          <button
            className="secondary-button"
            onClick={() => navigate("/settings")}
          >
            Configure sources
          </button>
        </div>
        <span className="fine-print">
          <UIcon name="shield" size={13} /> No accounts, credentials, or
          uploads.
        </span>
      </div>
    );
  if (u.view.isPending)
    return (
      <div className="loading-state">
        <UIcon name="refresh" className="spinning" />
        Reading verified usage…
      </div>
    );
  if (u.view.isError && !u.view.data)
    return (
      <div className="empty-feature">
        <UIcon name="info" size={30} />
        <h2>Couldn’t load this view</h2>
        <p>{errorMessage(u.view.error)}</p>
        <button className="secondary-button" onClick={u.reset}>
          Reset filters
        </button>
      </div>
    );
  return (
    <>
      {u.view.data?.stale && (
        <div className="coverage-banner warning">
          <UIcon name="clock" size={16} />
          <span>
            <strong>Stale cached snapshot.</strong>{" "}
            {u.bootstrap.data.lastError?.message ||
              "Settings changed; refresh to verify this snapshot."}
          </span>
          <button onClick={() => u.refresh.mutate()}>Retry refresh</button>
        </div>
      )}
      {u.view.data?.summary.missingPricing && (
        <div className="coverage-banner warning">
          <UIcon name="info" size={16} />
          <span>
            <strong>Partial estimate.</strong> Known priced usage plus unpriced
            models. Unknown pricing is not free usage.
          </span>
        </div>
      )}
      {children}
    </>
  );
}
export function ExportButton({ report }: { report: string }) {
  const u = useUsage();
  const [busy, setBusy] = useState(false);
  async function run(format: "csv" | "json") {
    setBusy(true);
    try {
      if (isDesktop) {
        const saved = await invoke<string | null>("save_report", {
          report,
          query: u.query,
          format,
        });
        if (!saved) return;
        u.setNotice(
          <span>
            Report export complete.{" "}
            <button
              className="toast-link"
              title={saved}
              onClick={() =>
                void revealItemInDir(saved).catch((e) =>
                  u.setNotice(errorMessage(e)),
                )
              }
            >
              {navigator.platform.startsWith("Mac")
                ? "Show in Finder"
                : navigator.platform.startsWith("Win")
                  ? "Show in Explorer"
                  : "Show in folder"}
            </button>
          </span>,
        );
        return;
      } else {
        const data = await usageApi.export(report, u.query, format);
        const url = URL.createObjectURL(
          new Blob([data], {
            type: format === "json" ? "application/json" : "text/csv",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `usage-${report}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      }
      u.setNotice("Report export complete.");
    } catch (e) {
      u.setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PopupMenu
      label={busy ? "Exporting…" : "Export"}
      icon={<UIcon name="download" size={14} />}
      disabled={busy}
      items={(["csv", "json"] as const).map((format) => ({
        id: `export-${format}`,
        label: `Export ${format.toUpperCase()}…`,
        onSelect: () => void run(format),
      }))}
    />
  );
}
export function CostLabel({ short = false }: { short?: boolean }) {
  return (
    <span title={costDescription}>
      {short ? "Est. cost" : "Est. API-equivalent cost"}
      <UIcon name="info" size={12} />
    </span>
  );
}
export function ProviderSplit({ daily }: { daily: DailyUsage[] }) {
  const totals = ["claude", "codex"].map((provider) => ({
    provider,
    cost: daily
      .filter((d) => d.provider === provider)
      .reduce((a, d) => a + d.costMicros, 0),
  }));
  const total = totals.reduce((a, p) => a + p.cost, 0);
  return (
    <div className="provider-split">
      <div className="split-bar" aria-label="Provider share of estimated cost">
        {totals.map((t) => (
          <span
            key={t.provider}
            className={t.provider}
            style={{ width: `${total ? (t.cost / total) * 100 : 50}%` }}
          />
        ))}
      </div>
      {totals.map((t) => (
        <div className="provider-breakdown" key={t.provider}>
          <ProviderMark provider={t.provider} label />
          <strong>
            <PeriodCost value={t.cost} />
          </strong>
          <span>{total ? Math.round((t.cost / total) * 100) : 0}%</span>
        </div>
      ))}
      <p className="panel-footnote">
        Estimated API-equivalent value of recorded usage.
      </p>
    </div>
  );
}
export function UsageChart({ daily }: { daily: DailyUsage[] }) {
  const u = useUsage();
  const navigate = useNavigate();
  const [metric, setMetric] = useState("cost");
  const [aggregation, setAggregation] = useState("day");
  const [hover, setHover] = useState<Bucket | null>(null);
  const buckets = bucketDaily(daily, u.query.since, u.query.until, aggregation);
  const value = (b: Bucket) =>
    metric === "cost" ? b.claude + b.codex : b.tokens;
  const maximum = Math.max(...buckets.map(value), 1);
  const scale = Math.pow(10, Math.floor(Math.log10(maximum)));
  const top = Math.ceil(maximum / scale) * scale;
  const label = (n: number) => (metric === "cost" ? money(n) : compact(n));
  const tickIndices = new Set([
    0,
    Math.floor(buckets.length / 4),
    Math.floor(buckets.length / 2),
    Math.floor((buckets.length * 3) / 4),
    buckets.length - 1,
  ]);
  return (
    <Panel
      title="Usage over time"
      subtitle="Usage recorded in the selected period"
      actions={
        <div className="chart-controls">
          <div className="segmented">
            {["cost", "tokens"].map((m) => (
              <button
                key={m}
                className={metric === m ? "selected" : ""}
                onClick={() => setMetric(m)}
              >
                {m === "cost" ? "Cost" : "Tokens"}
              </button>
            ))}
          </div>
          <select
            aria-label="Chart aggregation"
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value)}
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      }
      className="usage-chart-panel"
    >
      <div className="usage-chart">
        <div className="chart-y-axis">
          {[1, 0.75, 0.5, 0.25, 0].map((t) => (
            <span key={t}>{label(top * t)}</span>
          ))}
        </div>
        <div className="chart-plot">
          <div className="chart-grid">
            {[1, 0.75, 0.5, 0.25, 0].map((t) => (
              <i key={t} />
            ))}
          </div>
          <div className="chart-bars">
            {buckets.map((b, i) => {
              const cost = b.claude + b.codex;
              const height = (value(b) / top) * 100;
              const name =
                aggregation === "month"
                  ? displayDate(`${b.date}-01`, {
                      month: "long",
                      year: "numeric",
                    })
                  : displayDate(b.date);
              return (
                <div className="chart-column" key={b.date}>
                  <button
                    aria-label={`${name}: ${label(value(b))}${!b.covered ? ", no recorded coverage" : ""}. Open sessions.`}
                    title={`${name}\nClaude: ${money(b.claude)}\nCodex: ${money(b.codex)}\n${compact(b.tokens)} tokens`}
                    className={`chart-bar ${!b.covered ? "no-coverage" : ""}`}
                    style={{ height: `${Math.max(height, 0.7)}%` }}
                    onMouseEnter={() => setHover(b)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(b)}
                    onBlur={() => setHover(null)}
                    onClick={() => {
                      if (aggregation === "day") {
                        u.setDayOverride(b.date);
                      } else {
                        u.setRange("custom");
                        u.setCustomSince(
                          aggregation === "month" ? `${b.date}-01` : b.date,
                        );
                        const d = new Date(
                          `${aggregation === "month" ? `${b.date}-01` : b.date}T12:00:00`,
                        );
                        if (aggregation === "week") d.setDate(d.getDate() + 6);
                        else {
                          d.setMonth(d.getMonth() + 1);
                          d.setDate(0);
                        }
                        u.setCustomUntil(
                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                        );
                      }
                      navigate("/sessions");
                    }}
                  >
                    <span
                      className="codex"
                      style={{
                        height: `${cost ? (b.codex / cost) * 100 : 0}%`,
                      }}
                    />
                    <span
                      className="claude"
                      style={{
                        height: `${cost ? (b.claude / cost) * 100 : 100}%`,
                      }}
                    />
                  </button>
                  <span className="chart-x-label">
                    {tickIndices.has(i)
                      ? aggregation === "month"
                        ? displayDate(`${b.date}-01`, { month: "short" })
                        : displayDate(b.date)
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
          {!buckets.length && (
            <div className="chart-no-data">
              No recorded usage in this period.
            </div>
          )}
        </div>
      </div>
      <div className="chart-footer">
        <div className="legend">
          <span>
            <i className="claude" />
            Claude Code
          </span>
          <span>
            <i className="codex" />
            Codex
          </span>
          <span>
            <i className="uncovered" />
            No recorded coverage
          </span>
        </div>
        <span>
          {hover ? (
            <>
              <strong>
                {displayDate(
                  hover.date.length === 7 ? `${hover.date}-01` : hover.date,
                )}
              </strong>{" "}
              · {label(value(hover))}
            </>
          ) : (
            "Select a bar to explore sessions ↗"
          )}
        </span>
      </div>
      <details className="accessible-data">
        <summary>View chart data table</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Claude (USD est.)</th>
              <th>Codex (USD est.)</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.date}>
                <td>{b.date}</td>
                <td>{money(b.claude)}</td>
                <td>{money(b.codex)}</td>
                <td>{compact(b.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Panel>
  );
}
