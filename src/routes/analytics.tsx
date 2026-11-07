import { SessionActivityBadge } from "@/components/session-activity-badge";
import { NewSessionBadge } from "@/components/new-session-badge";
import { ProjectIcon, ProjectLabel } from "@/components/project-icon";
import { DailyActivity } from "@/components/daily-activity";
import { PeriodCost } from "@/components/period-cost";
import { periodCostDescription } from "@/lib/costs";
import { bucketDaily } from "@/lib/chart-data";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useUsage } from "@/lib/usage-context";
import {
  compact,
  costDescription,
  displayDate,
  modelName,
  money,
  number,
} from "@/lib/format";
import {
  DataBoundary,
  ExportButton,
  PageHeading,
  Panel,
  ProviderSplit,
  UsageChart,
} from "@/components/usage-components";
import { ProviderMark, UIcon } from "@/components/usage-icon";
import { usageApi, errorMessage } from "@/lib/usage-api";
function Change({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined || previous === 0)
    return (
      <span className="metric-change neutral">
        N/A <span>vs. previous period</span>
      </span>
    );
  const percent = ((current - previous) / previous) * 100;
  return (
    <span className={`metric-change ${percent <= 0 ? "down" : "up"}`}>
      {percent > 0 ? "↗" : "↘"} {Math.abs(percent).toFixed(1)}%{" "}
      <span>vs. previous period</span>
    </span>
  );
}
function Metrics() {
  const u = useUsage();
  const v = u.view.data!;
  const items: {
    label: string;
    value: string;
    current: number;
    previous?: number;
    icon: "activity" | "terminal" | "sessions" | "folder";
  }[] = [
    {
      label: "Est. API-equivalent cost",
      value: money(v.summary.costMicros),
      current: v.summary.costMicros,
      previous: v.previous?.costMicros,
      icon: "activity",
    },
    {
      label: "Recorded tokens",
      value: compact(v.summary.tokens.total),
      current: v.summary.tokens.total,
      previous: v.previous?.tokens.total,
      icon: "terminal",
    },
    {
      label: "Active sessions",
      value: number(v.summary.sessions),
      current: v.summary.sessions,
      previous: v.previous?.sessions,
      icon: "sessions",
    },
    {
      label: "Active projects",
      value: number(v.summary.projects),
      current: v.summary.projects,
      previous: v.previous?.projects,
      icon: "folder",
    },
  ];
  return (
    <div className="metrics-grid">
      {items.map((m, i) => (
        <section className={`metric-card metric-${i}`} key={m.label}>
          <div className="metric-label">
            <span title={i === 0 ? costDescription : undefined}>{m.label}</span>
            <UIcon name={m.icon} size={16} />
          </div>
          <strong className="metric-value">
            {i === 0 ? <PeriodCost value={v.summary.costMicros} /> : m.value}
            {i === 0 && v.summary.missingPricing && (
              <small>known + unpriced</small>
            )}
          </strong>
          <Change current={m.current} previous={m.previous} />
        </section>
      ))}
    </div>
  );
}
export function Overview() {
  const u = useUsage();
  const navigate = useNavigate();
  const v = u.view.data;
  const daily = v?.daily || [];
  const biggest = bucketDaily(daily, u.query.since, u.query.until, "day").sort(
    (a, b) => b.claude + b.codex - a.claude - a.codex,
  )[0];
  const cache = v
    ? Math.round(
        (v.summary.tokens.cacheRead /
          Math.max(
            1,
            v.summary.tokens.input +
              v.summary.tokens.cacheRead +
              v.summary.tokens.cacheCreation,
          )) *
          100,
      )
    : 0;
  const topFive =
    v?.topSessions.reduce((a, s) => a + (s.periodCostMicros ?? 0), 0) || 0;
  return (
    <div className="page analytics-page">
      <PageHeading title="Overview" actions={<ExportButton report="daily" />} />
      <DataBoundary>
        {v && (
          <>
            <Metrics />
            <UsageChart daily={daily} />
            <div className="secondary-metrics">
              <div>
                <span>Average active day</span>
                <strong>
                  {money(
                    v.summary.costMicros / Math.max(v.summary.activeDays, 1),
                  )}
                </strong>
              </div>
              <div>
                <span>Cache-read share of input</span>
                <strong>
                  {cache}%<small> recorded tokens</small>
                </strong>
              </div>
              <div>
                <span>Top model by estimated cost</span>
                <strong>
                  {v.models[0]
                    ? modelName(v.models[0].model)
                    : "No recorded usage"}
                </strong>
              </div>
              <div>
                <span>Recorded active days</span>
                <strong>
                  {v.summary.activeDays}
                  <small> in this period</small>
                </strong>
              </div>
            </div>
            <div className="overview-middle">
              <Panel title="Provider mix">
                <ProviderSplit daily={daily} />
              </Panel>
              <DailyActivity />
            </div>
            <div className="two-columns">
              <Panel
                title="Top sessions"
                subtitle="Usage in the selected period"
                actions={
                  <button
                    className="text-button"
                    onClick={() => navigate("/sessions")}
                  >
                    View all <UIcon name="arrow" size={14} />
                  </button>
                }
              >
                <div className="rank-list">
                  {v.topSessions.map((s, i) => (
                    <button
                      key={s.key}
                      className="rank-row"
                      onClick={() => u.setSelected(s)}
                    >
                      <span className="rank-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <ProviderMark provider={s.provider} />
                      <div>
                        <span className="session-title-with-badge">
                          <strong>{s.title}</strong>
                          <SessionActivityBadge
                            state={u.sessionActivity(s.key)}
                          />
                          {u.isNewSession(s.key) && <NewSessionBadge />}
                        </span>
                        <small>
                          <ProjectLabel path={s.projectPath}>
                            {s.project}
                          </ProjectLabel>{" "}
                          <span>·</span>{" "}
                          {modelName(s.models[0]?.model || "Unknown")}
                        </small>
                      </div>
                      <span className="rank-value">
                        <PeriodCost
                          value={s.periodCostMicros}

                          partial={s.missingPricing}
                        />
                      </span>
                      <UIcon name="chevron" size={13} />
                    </button>
                  ))}
                  {!v.topSessions.length && (
                    <p className="no-results">
                      No sessions active in this period.
                    </p>
                  )}
                </div>
              </Panel>
              <Panel
                title="Top projects"
                subtitle="Usage in the selected period"
                actions={
                  <button
                    className="text-button"
                    onClick={() => navigate("/projects")}
                  >
                    View all <UIcon name="arrow" size={14} />
                  </button>
                }
              >
                <div className="project-ranks">
                  {v.projects.slice(0, 5).map((p, i) => (
                    <button
                      className="project-rank"
                      key={p.key}
                      onClick={() => {
                        u.updateFilters({ projects: [p.key] });
                        navigate("/sessions");
                      }}
                    >
                      <span className="project-rank-icon">
                        <ProjectIcon path={p.key} size={20} />
                      </span>
                      <div>
                        <div>
                          <strong>{p.name}</strong>
                          <span>
                            <PeriodCost value={p.periodCostMicros} />
                          </span>
                        </div>
                        <div className="project-progress">
                          <span
                            style={{
                              width: `${((p.periodCostMicros ?? 0) / Math.max(v.projects[0]?.periodCostMicros || 1, 1)) * 100}%`,
                              opacity: 1 - i * 0.12,
                            }}
                          />
                        </div>
                      </div>
                      <small>{p.sessions} sessions</small>
                    </button>
                  ))}
                </div>
              </Panel>
            </div>
            {biggest && biggest.claude + biggest.codex > 0 && (
              <div className="insight-strip">
                <span className="insight-icon">
                  <UIcon name="activity" size={17} />
                </span>
                <p>
                  <strong>
                    {displayDate(biggest.date, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    was your highest-usage day
                  </strong>{" "}
                  at {money(biggest.claude + biggest.codex)}. Your top five
                  sessions represent{" "}
                  {Math.round(
                    (topFive / Math.max(v.summary.costMicros, 1)) * 100,
                  )}
                  % of this period’s estimated cost.
                </p>
              </div>
            )}
            <p className="cost-disclaimer">
              <UIcon name="info" size={13} />
              {costDescription} Offline pricing snapshot · ccusage{" "}
              {v.engineVersion}.
            </p>
          </>
        )}
      </DataBoundary>
    </div>
  );
}
export function Projects() {
  const u = useUsage();
  const navigate = useNavigate();
  const [sort, setSort] = useState("periodCost");
  const [aliasKey, setAliasKey] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const v = u.view.data;
  const projects = [...(v?.projects || [])].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "sessions"
        ? b.sessions - a.sessions
        : sort === "last"
          ? b.lastActivity.localeCompare(a.lastActivity)
          : (b.periodCostMicros ?? -1) - (a.periodCostMicros ?? -1),
  );
  async function saveAlias() {
    if (aliasKey === null) return;
    try {
      await usageApi.alias(aliasKey, alias);
      setAliasKey(null);
      await u.invalidate();
      u.setNotice("Project display name saved locally.");
    } catch (e) {
      u.setNotice(errorMessage(e));
    }
  }
  return (
    <div className="page">
      <PageHeading
        title="Projects"
        actions={<ExportButton report="projects" />}
      />
      <DataBoundary>
        <div className="coverage-banner">
          <UIcon name="info" size={16} />
          <span>Costs include usage recorded in the selected period.</span>
        </div>
        <div className="section-toolbar">
          <span>{projects.length} active projects</span>
          <label>
            Sort by{" "}
            <select
              aria-label="Project sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="periodCost">Estimated cost</option>
              <option value="sessions">Session count</option>
              <option value="last">Last active</option>
              <option value="name">Project name</option>
            </select>
          </label>
        </div>
        <div className="project-grid">
          {projects.map((p) => (
            <section className="project-card" key={p.key}>
              <header>
                <span className="project-icon">
                  <ProjectIcon path={p.key} size={28} />
                </span>
                <button
                  className="text-button"
                  title="Change local project display name"
                  onClick={() => {
                    setAliasKey(p.key);
                    setAlias(p.name);
                  }}
                >
                  Rename
                </button>
              </header>
              <button
                className="project-card-title"
                title={p.key}
                onClick={() => {
                  u.updateFilters({ projects: [p.key] });
                  navigate("/sessions");
                }}
              >
                {p.name}
                <UIcon name="arrow" size={16} />
              </button>
              <small>Last active {displayDate(p.lastActivity)}</small>
              <div className="project-cost">
                <strong>
                  <PeriodCost value={p.periodCostMicros} />
                </strong>
                <span title={periodCostDescription}>
                  Est. API-equivalent cost
                </span>
              </div>
              <div
                className="split-bar"
                title="Provider share of cost in the selected period"
              >
                <span
                  className="claude"
                  style={{
                    width: `${(p.claudeMicros / Math.max(p.periodCostMicros ?? 0, 1)) * 100}%`,
                  }}
                />
                <span
                  className="codex"
                  style={{
                    width: `${(p.codexMicros / Math.max(p.periodCostMicros ?? 0, 1)) * 100}%`,
                  }}
                />
              </div>
              <div className="project-card-footer">
                <span>{p.sessions} sessions</span>
                <span>{compact(p.tokens.total)} tokens</span>
              </div>
              <div className="project-model">
                <UIcon name="models" size={13} />
                {modelName(p.topModel)}
              </div>
            </section>
          ))}
        </div>
        {!projects.length && (
          <div className="no-results">
            No projects in this period. Try a wider date range.
          </div>
        )}
        {aliasKey !== null && (
          <div className="inline-alias">
            <label>
              Local display name
              <input
                value={alias}
                maxLength={80}
                onChange={(e) => setAlias(e.target.value)}
              />
            </label>
            <button className="primary-button" onClick={() => void saveAlias()}>
              Save name
            </button>
            <button
              className="secondary-button"
              onClick={() => setAliasKey(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </DataBoundary>
    </div>
  );
}
export function Models() {
  const u = useUsage();
  const v = u.view.data;
  const [sort, setSort] = useState("cost");
  const models = [...(v?.models || [])].sort((a, b) =>
    sort === "name"
      ? a.model.localeCompare(b.model)
      : sort === "output"
        ? b.tokens.output - a.tokens.output
        : b.costMicros - a.costMicros,
  );
  return (
    <div className="page">
      <PageHeading title="Models" actions={<ExportButton report="models" />} />
      <DataBoundary>
        {v && (
          <>
            <div className="model-summary">
              <Panel
                title="Cost by model"
                subtitle="Event-day usage within the selected period"
              >
                <div className="model-bars">
                  {models.map((m, i) => (
                    <div className="model-bar-row" key={m.model}>
                      <div>
                        <span>
                          <i
                            style={{
                              background: [
                                "var(--accent)",
                                "var(--claude)",
                                "var(--codex)",
                              ][i % 3],
                            }}
                          />
                          {modelName(m.model)}
                        </span>
                        <strong>
                          <PeriodCost
                            value={m.costMicros}

                            partial={m.missingPricing}
                          />
                        </strong>
                      </div>
                      <div className="model-bar-track">
                        <span
                          style={{
                            width: `${(m.costMicros / Math.max(v.summary.costMicros, 1)) * 100}%`,
                            background: [
                              "var(--accent)",
                              "var(--claude)",
                              "var(--codex)",
                            ][i % 3],
                          }}
                        />
                      </div>
                      <small>
                        {Math.round(
                          (m.costMicros / Math.max(v.summary.costMicros, 1)) *
                            100,
                        )}
                        % of known estimated cost
                      </small>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel
                title="Token composition"
                subtitle="Recorded token categories, across models"
              >
                <div className="token-composition">
                  {(
                    [
                      { key: "input", label: "Input", color: "var(--accent)" },
                      {
                        key: "output",
                        label: "Output",
                        color: "var(--claude)",
                      },
                      {
                        key: "cacheRead",
                        label: "Cache read",
                        color: "var(--codex)",
                      },
                      {
                        key: "cacheCreation",
                        label: "Cache creation",
                        color: "var(--muted)",
                      },
                    ] as const
                  ).map((t) => (
                    <div key={t.key}>
                      <span>
                        <i style={{ background: t.color }} />
                        {t.label}
                      </span>
                      <strong>{compact(v.summary.tokens[t.key])}</strong>
                      <div className="composition-track">
                        <span
                          style={{
                            width: `${(v.summary.tokens[t.key] / Math.max(v.summary.tokens.total, 1)) * 100}%`,
                            background: t.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            <div className="section-toolbar">
              <h2>Model breakdown</h2>
              <label>
                Sort by
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Model sort"
                >
                  <option value="cost">Estimated cost</option>
                  <option value="output">Output tokens</option>
                  <option value="name">Model name</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="numeric">Input</th>
                    <th className="numeric">Output</th>
                    <th className="numeric">Cache read</th>
                    <th className="numeric">Cache creation</th>
                    <th className="numeric">
                      <span title={periodCostDescription}>
                        Est. API-equivalent cost
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.model}>
                      <td>
                        <strong>{modelName(m.model)}</strong>
                        <small className="machine-id">{m.model}</small>
                        {m.missingPricing && (
                          <span className="subtle-badge warning">
                            Partial pricing
                          </span>
                        )}
                      </td>
                      <td className="numeric">{compact(m.tokens.input)}</td>
                      <td className="numeric">{compact(m.tokens.output)}</td>
                      <td className="numeric">{compact(m.tokens.cacheRead)}</td>
                      <td className="numeric">
                        {compact(m.tokens.cacheCreation)}
                      </td>
                      <td className="numeric strong">
                        <PeriodCost
                          value={m.costMicros}

                          partial={m.missingPricing}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!models.length && (
                <p className="no-results">
                  No model usage recorded in this period.
                </p>
              )}
            </div>
            <p className="cost-disclaimer">
              <UIcon name="info" size={13} />
              Models may handle different kinds of work. Token volume and
              estimated cost do not measure model quality.
            </p>
          </>
        )}
      </DataBoundary>
    </div>
  );
}
