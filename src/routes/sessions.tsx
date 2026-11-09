import { SessionActivityBadge } from "@/components/session-activity-badge";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useUsage } from "@/lib/usage-context";
import { usageApi, errorMessage } from "@/lib/usage-api";
import {
  compact,
  dateKey,
  displayDate,
  displayDay,
  modelName,
  money,
  number,
  time,
} from "@/lib/format";
import {
  DataBoundary,
  ExportButton,
  PageHeading,
} from "@/components/usage-components";
import { ProviderMark, UIcon } from "@/components/usage-icon";
import { NewSessionBadge } from "@/components/new-session-badge";
import { SessionCostInfo } from "@/components/session-cost-info";
import { PeriodCost } from "@/components/period-cost";
import {
  periodCostDescription,
  lifetimeCostDescription,
  sessionPeriodCost,
  sessionModelPeriodCost,
} from "@/lib/costs";
import { PopupMenu } from "@/components/popup-menu";
import { FilterMultiSelect } from "@/components/filter-multi-select";
import { ProjectLabel } from "@/components/project-icon";
import { sessionActivityDays, sessionFirstUsageDate } from "@/lib/session-days";
import type { Annotation, Query, Session } from "@/lib/usage-types";
import {
  sessionColumnSort,
  sessionGroupsDescending,
  type SessionSortColumn,
} from "@/lib/session-sort";
function groupKey(s: Session, group: string, tz: string, weekStart: string) {
  const day = dateKey(new Date(s.lastActivity), tz);
  if (group === "project") return s.projectPath;
  if (group === "provider") return s.provider;
  if (group === "none") return "All sessions";
  if (group === "month") return day.slice(0, 7);
  if (group === "week") {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(
      d.getDate() -
        (weekStart === "sunday" ? d.getDay() : (d.getDay() + 6) % 7),
    );
    return dateKey(d);
  }
  return day;
}
function groupLabel(key: string, group: string, s: Session, timezone: string) {
  if (group === "project") return s.project;
  if (group === "provider") return key === "claude" ? "Claude Code" : "Codex";
  if (group === "none") return key;
  if (group === "day") return displayDay(key, timezone);
  if (group === "month")
    return displayDate(`${key}-01`, { month: "long", year: "numeric" });
  return `${group === "week" ? "Week of " : ""}${displayDate(key, { month: "long", day: "numeric", year: "numeric" })}`;
}
export function Sessions() {
  const u = useUsage();
  const v = u.view.data;
  const [search, setSearch] = useState(u.filters.search);
  const group = u.filters.groupBy;
  const setGroup = (groupBy: string) => u.updateFilters({ groupBy });
  const [advanced, setAdvanced] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [tableElement, setTableElement] = useState<HTMLDivElement | null>(null);
  const [tableWidth, setTableWidth] = useState(Infinity);
  useEffect(() => {
    if (!tableElement) return;
    const observer = new ResizeObserver(([entry]) => {
      setTableWidth(entry.contentRect.width);
    });
    observer.observe(tableElement);
    return () => observer.disconnect();
  }, [tableElement]);
  const compactTable = tableWidth < 1000;
  const narrowTable = tableWidth < 760;
  const fits = (column: string) =>
    column === "tokens"
      ? !compactTable
      : column === "models"
        ? !narrowTable
        : column === "project"
          ? tableWidth >= 540
          : true;
  const [loadMoreTarget, setLoadMoreTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const {
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isError,
  } = u.sessionsView;
  useEffect(() => {
    if (
      !loadMoreTarget ||
      !hasNextPage ||
      isFetching ||
      isError ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          void fetchNextPage({ cancelRefetch: false });
      },
      {
        root: loadMoreTarget.closest(".page-scroll"),
        rootMargin: "0px 0px 400px 0px",
      },
    );
    observer.observe(loadMoreTarget);
    return () => observer.disconnect();
  }, [loadMoreTarget, hasNextPage, isFetching, isError, fetchNextPage]);
  const groupsDescending = sessionGroupsDescending(u.filters);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (search !== u.filters.search) u.updateFilters({ search });
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);
  const groups = new Map<string, Session[]>();
  for (const s of v?.sessions || []) {
    const key = groupKey(s, group, u.prefs.timezone, u.prefs.weekStart);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const sortedGroups = [...groups.entries()].sort(
    ([a], [b]) => a.localeCompare(b) * (groupsDescending ? -1 : 1),
  );
  const advancedFilterCount =
    Number(!!u.filters.provenance) +
    Number(!!u.filters.tag) +
    Number(u.filters.minCost !== null) +
    Number(u.filters.maxCost !== null) +
    Number(u.filters.minTokens !== null) +
    Number(u.filters.maxTokens !== null);
  const filterCount =
    advancedFilterCount +
    u.filters.projects.length +
    u.filters.models.length +
    Number(u.filters.favorite) +
    Number(!!u.filters.sourceId);
  const visible = (column: string) => !hidden.includes(column) && fits(column);
  const columns =
    6 +
    Number(visible("project")) +
    Number(visible("models")) +
    Number(visible("tokens"));
  function sortHeader(
    column: SessionSortColumn,
    label: string,
    numeric = false,
    content: ReactNode = label,
  ) {
    const active = u.filters.sort === column;
    const nextSort = sessionColumnSort(u.filters, column);
    const action = `Sort by ${label.toLowerCase()} ${nextSort.descending ? "descending" : "ascending"}`;
    return (
      <th
        scope="col"
        className={numeric ? "numeric" : undefined}
        aria-sort={
          active
            ? u.filters.descending
              ? "descending"
              : "ascending"
            : undefined
        }
      >
        <button
          type="button"
          className="session-column-sort"
          onClick={() => u.updateFilters(nextSort)}
          title={action}
          aria-label={action}
        >
          {content}
          <UIcon
            name={
              active
                ? u.filters.descending
                  ? "sort-descending"
                  : "sort-ascending"
                : "sort"
            }
            size={13}
          />
        </button>
      </th>
    );
  }
  function multi(field: "projects" | "models", value: string) {
    u.updateFilters({
      [field]: u.filters[field].includes(value)
        ? u.filters[field].filter((v) => v !== value)
        : [...u.filters[field], value],
    });
  }
  function reset() {
    u.updateFilters({
      ...u.filters,
      projects: [],
      models: [],
      search: "",
      favorite: false,
      tag: "",
      provenance: "",
      sourceId: "",
      minCost: null,
      maxCost: null,
      minTokens: null,
      maxTokens: null,
      offset: 0,
    });
    setSearch("");
  }
  return (
    <div className="page sessions-page">
      <PageHeading
        title={v ? `Sessions (${number(v.sessionCount)})` : "Sessions"}
        actions={<ExportButton report="sessions" />}
      />
      <DataBoundary>
        <div className="session-controls">
          <label className="session-search">
            <UIcon name="search" size={16} />
            <input
              id="session-search"
              placeholder="Search by title, project, or session ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search sessions"
            />
            <kbd>⌘ F</kbd>
          </label>
          <div className="session-order-controls">
            <label>
              Group
              <select
                aria-label="Group sessions"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="project">Project</option>
                <option value="provider">Provider</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
        </div>
        <div
          className="filter-input-grid session-primary-filters"
          role="group"
          aria-label="Common session filters"
        >
          <FilterMultiSelect
            label="Projects"
            renderOption={({ value, label }) => (
              <ProjectLabel path={value}>{label}</ProjectLabel>
            )}
            hideLabel
            options={(v?.availableProjects || []).map(([path, name]) => ({
              value: path,
              label: name,
              title: path,
            }))}
            selected={u.filters.projects}
            onToggle={(value) => multi("projects", value)}
            onClear={() => u.updateFilters({ projects: [] })}
          />
          <FilterMultiSelect
            label="Models"
            hideLabel
            options={(v?.availableModels || []).map((model) => ({
              value: model,
              label: modelName(model),
            }))}
            selected={u.filters.models}
            onToggle={(value) => multi("models", value)}
            onClear={() => u.updateFilters({ models: [] })}
          />
          <label>
            <span className="sr-only">Data source</span>
            <select
              value={u.filters.sourceId}
              onChange={(e) => u.updateFilters({ sourceId: e.target.value })}
            >
              <option value="">All sources</option>
              {v?.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.provider === "claude" ? "Claude Code" : "Codex"} · {s.root}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-field">
            <button
              type="button"
              className="filter-favorite-toggle"
              title="Show sessions you've starred in session details"
              aria-pressed={u.filters.favorite}
              onClick={() => u.updateFilters({ favorite: !u.filters.favorite })}
            >
              <UIcon name="star" size={15} />
              Favorites only
              <span className="filter-toggle-track" aria-hidden="true">
                <span />
              </span>
            </button>
          </div>
          <button
            className={`secondary-button ${advanced ? "active" : ""}`}
            onClick={() => setAdvanced(!advanced)}
            aria-expanded={advanced}
            aria-controls="session-filters"
          >
            <UIcon name="filter" size={16} />
            Filters
            {advancedFilterCount > 0 && (
              <span className="filter-count">{advancedFilterCount}</span>
            )}
          </button>
        </div>
        {advanced && (
          <div className="advanced-filters" id="session-filters">
            <div className="filter-input-grid">
              <label>
                Title provenance
                <select
                  value={u.filters.provenance}
                  onChange={(e) =>
                    u.updateFilters({ provenance: e.target.value })
                  }
                >
                  <option value="">All titles</option>
                  <option value="native">Provider native</option>
                  <option value="prompt">Prompt fallback</option>
                  <option value="local">Local override</option>
                  <option value="identifier">Identifier</option>
                </select>
              </label>
              <fieldset className="filter-range-field">
                <legend>Cost (USD)</legend>
                <div className="filter-range">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Minimum cost (usd)"
                    placeholder="Minimum"
                    value={u.filters.minCost ?? ""}
                    onChange={(event) =>
                      u.updateFilters({
                        minCost:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Maximum cost (usd)"
                    placeholder="Maximum"
                    value={u.filters.maxCost ?? ""}
                    onChange={(event) =>
                      u.updateFilters({
                        maxCost:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </div>
              </fieldset>
              <fieldset className="filter-range-field">
                <legend>Tokens</legend>
                <div className="filter-range">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    aria-label="Minimum tokens"
                    placeholder="Minimum"
                    value={u.filters.minTokens ?? ""}
                    onChange={(event) =>
                      u.updateFilters({
                        minTokens:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    aria-label="Maximum tokens"
                    placeholder="Maximum"
                    value={u.filters.maxTokens ?? ""}
                    onChange={(event) =>
                      u.updateFilters({
                        maxTokens:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </div>
              </fieldset>
              <label>
                Tag
                <input
                  value={u.filters.tag}
                  placeholder="e.g. review"
                  onChange={(e) => u.updateFilters({ tag: e.target.value })}
                />
              </label>
            </div>
          </div>
        )}
        {(filterCount > 0 || u.filters.search) && (
          <div className="filter-chips">
            {u.filters.search && (
              <button
                onClick={() => {
                  setSearch("");
                  u.updateFilters({ search: "" });
                }}
              >
                Search: {u.filters.search}
                <UIcon name="close" size={11} />
              </button>
            )}
            {u.filters.projects.map((p) => (
              <button key={p} onClick={() => multi("projects", p)}>
                <ProjectLabel path={p}>
                  {v?.availableProjects.find(([key]) => key === p)?.[1] || p}
                </ProjectLabel>
                <UIcon name="close" size={11} />
              </button>
            ))}
            {u.filters.models.map((m) => (
              <button key={m} onClick={() => multi("models", m)}>
                {modelName(m)}
                <UIcon name="close" size={11} />
              </button>
            ))}
            {(
              [
                "favorite",
                "provenance",
                "sourceId",
                "tag",
                "minCost",
                "maxCost",
                "minTokens",
                "maxTokens",
              ] as const
            )
              .filter(
                (k) =>
                  u.filters[k] !== null &&
                  u.filters[k] !== false &&
                  u.filters[k] !== "",
              )
              .map((k) => (
                <button
                  key={k}
                  onClick={() =>
                    u.updateFilters({
                      [k]:
                        k === "favorite"
                          ? false
                          : [
                                "minCost",
                                "maxCost",
                                "minTokens",
                                "maxTokens",
                              ].includes(k)
                            ? null
                            : "",
                    } as Partial<Query>)
                  }
                >
                  {k === "favorite"
                    ? "Favorites"
                    : k === "sourceId"
                      ? `Data source: ${v?.sources.find((source) => source.id === u.filters.sourceId)?.root || u.filters.sourceId}`
                      : `${k}: ${u.filters[k]}`}
                  <UIcon name="close" size={11} />
                </button>
              ))}
            <button className="reset-filters" onClick={reset}>
              Reset session filters
            </button>
          </div>
        )}
        <div className="table-wrap sessions-table-wrap" ref={setTableElement}>
          <table
            className="data-table sessions-table"
            data-compact={compactTable || undefined}
            data-narrow={narrowTable || undefined}
          >
            <thead>
              <tr>
                <th className="expand-cell" />
                {sortHeader(
                  "last",
                  "Last activity",
                  false,
                  compactTable ? "Activity" : "Last activity",
                )}
                {sortHeader("name", "Session title")}
                {sortHeader(
                  "provider",
                  "Provider",
                  false,
                  compactTable ? (
                    <UIcon name="terminal" size={16} />
                  ) : (
                    "Provider"
                  ),
                )}
                {visible("project") && sortHeader("project", "Project")}
                {visible("models") && <th scope="col">Models</th>}
                {visible("tokens") && sortHeader("tokens", "Tokens", true)}
                {sortHeader(
                  "periodCost",
                  "Estimated cost",
                  true,
                  <span title={periodCostDescription}>Cost</span>,
                )}
                <th className="session-columns-cell">
                  <PopupMenu
                    label="Choose columns"
                    icon={<UIcon name="columns" size={16} />}
                    iconOnly
                    items={["project", "models", "tokens"].map((column) => ({
                      id: `column-${column}`,
                      label:
                        column.charAt(0).toUpperCase() +
                        column.slice(1) +
                        (fits(column) ? "" : " (hidden at this width)"),
                      checked: visible(column),
                      disabled: !fits(column),
                      onSelect: () =>
                        setHidden((hidden) =>
                          hidden.includes(column)
                            ? hidden.filter((value) => value !== column)
                            : [...hidden, column],
                        ),
                    }))}
                  />
                </th>
              </tr>
            </thead>
            {sortedGroups.map(([key, rows]) => (
              <tbody key={key}>
                {group !== "none" && (
                  <tr className="session-group-row">
                    <th colSpan={columns - 2} scope="rowgroup">
                      {group === "project" ? (
                        <ProjectLabel path={key}>
                          {groupLabel(key, group, rows[0], u.prefs.timezone)}
                        </ProjectLabel>
                      ) : (
                        groupLabel(key, group, rows[0], u.prefs.timezone)
                      )}
                      <small>
                        {v?.groupTotals[key]?.[0] ?? rows.length} session
                        {(v?.groupTotals[key]?.[0] ?? rows.length) !== 1
                          ? "s"
                          : ""}
                      </small>
                    </th>
                    <th className="numeric" title={periodCostDescription}>
                      <span className="session-cost">
                        {v?.groupPeriodTotals[key] == null
                          ? "—"
                          : money(v.groupPeriodTotals[key]!)}
                      </span>
                    </th>
                    <th className="session-columns-cell" aria-hidden="true" />
                  </tr>
                )}
                {rows.map((s) => (
                  <Fragment key={s.key}>
                    <tr className={expanded === s.key ? "expanded-row" : ""}>
                      <td className="expand-cell">
                        <button
                          className="row-expand"
                          aria-label={`${expanded === s.key ? "Collapse" : "Expand"} ${s.title}`}
                          aria-expanded={expanded === s.key}
                          onClick={() =>
                            setExpanded(expanded === s.key ? null : s.key)
                          }
                        >
                          <UIcon
                            name="chevron"
                            size={12}
                            style={{
                              transform:
                                expanded === s.key
                                  ? "rotate(90deg)"
                                  : undefined,
                            }}
                          />
                        </button>
                      </td>
                      <td className="session-time" title={s.lastActivity}>
                        {group === "day" ? (
                          time(s.lastActivity, u.prefs.timezone)
                        ) : (
                          <>
                            {displayDate(
                              dateKey(
                                new Date(s.lastActivity),
                                u.prefs.timezone,
                              ),
                            )}
                            <small>
                              {time(s.lastActivity, u.prefs.timezone)}
                            </small>
                          </>
                        )}
                      </td>
                      <td className="session-name-cell">
                        <button
                          className="session-name"
                          onClick={() => u.setSelected(s)}
                        >
                          {s.favorite && <UIcon name="star" size={12} />}
                          <strong>{s.title}</strong>
                          <SessionActivityBadge
                            state={u.sessionActivity(s.key)}
                          />
                          {u.isNewSession(s.key) && <NewSessionBadge />}
                        </button>
                      </td>
                      <td
                        className="session-provider"
                        title={
                          s.provider === "claude" ? "Claude Code" : "Codex"
                        }
                        aria-label={
                          s.provider === "claude" ? "Claude Code" : "Codex"
                        }
                      >
                        <ProviderMark
                          provider={s.provider}
                          label={!compactTable}
                        />
                      </td>
                      {visible("project") && (
                        <td className="session-project" title={s.projectPath}>
                          {s.projectPath ? (
                            <button
                              type="button"
                              className="project-folder-link"
                              aria-label={`Open project folder: ${s.projectPath}`}
                              onClick={() =>
                                void usageApi
                                  .open("project", s.key)
                                  .catch((e) => u.setNotice(errorMessage(e)))
                              }
                            >
                              <ProjectLabel path={s.projectPath}>
                                {s.project}
                              </ProjectLabel>
                            </button>
                          ) : (
                            <ProjectLabel path={s.projectPath}>
                              {s.project}
                            </ProjectLabel>
                          )}
                        </td>
                      )}
                      {visible("models") && (
                        <td className="session-model">
                          {modelName(s.models[0]?.model || "Unknown")}
                          {s.models.length > 1 && (
                            <small>+{s.models.length - 1}</small>
                          )}
                        </td>
                      )}
                      {visible("tokens") && (
                        <td className="numeric muted">
                          {compact(s.tokens.total)}
                        </td>
                      )}
                      <td className="numeric strong">
                        <span className="session-cost">
                          <PeriodCost
                            value={s.periodCostMicros}
                            partial={s.missingPricing}
                          />
                          <SessionCostInfo session={s} />
                        </span>
                      </td>
                      <td className="session-columns-cell" aria-hidden="true" />
                    </tr>
                    {expanded === s.key && (
                      <tr className="session-expansion">
                        <td colSpan={columns}>
                          <div>
                            <span>MODEL BREAKDOWN</span>
                            {s.models.map((m) => (
                              <div key={m.model}>
                                <strong>{modelName(m.model)}</strong>
                                <span>
                                  {compact(m.tokens.input)} input ·{" "}
                                  {compact(m.tokens.output)} output ·{" "}
                                  {compact(m.tokens.cacheRead)} cache read
                                </span>
                                <strong>
                                  <PeriodCost
                                    value={m.periodCostMicros}

                                    partial={m.missingPricing}
                                  />
                                </strong>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            ))}
          </table>
          {!v?.sessions.length && (
            <div className="no-results">
              <UIcon name="search" size={24} />
              <h3>No sessions match these filters.</h3>
              <p>Try a wider date range or reset your session filters.</p>
              <button className="secondary-button" onClick={reset}>
                Reset session filters
              </button>
            </div>
          )}
        </div>
        <div className="session-load-more" ref={setLoadMoreTarget}>
          <span role="status">
            {`${number(v?.sessions.length || 0)} of ${number(v?.sessionCount || 0)} sessions`}
            {isFetchingNextPage
              ? " · Loading more…"
              : isFetching
                ? " · Updating…"
                : !hasNextPage && v?.sessionCount
                  ? " · All sessions loaded"
                  : ""}
          </span>
          {isError && (
            <span role="alert">
              Couldn’t update sessions. {errorMessage(u.sessionsView.error)}
            </span>
          )}
          {(hasNextPage || isError) && (
            <button
              className="secondary-button"
              disabled={isFetching}
              onClick={() =>
                void (u.sessionsView.isFetchNextPageError || !isError
                  ? fetchNextPage({ cancelRefetch: false })
                  : u.sessionsView.refetch())
              }
            >
              {isFetchingNextPage
                ? "Loading more…"
                : isError
                  ? "Try again"
                  : "Load more sessions"}
            </button>
          )}
        </div>
      </DataBoundary>
    </div>
  );
}
export function SessionDrawer({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const u = useUsage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [s, setSession] = useState(session);
  const [title, setTitle] = useState(
    session.titleProvenance === "local" ? session.title : "",
  );
  const [tags, setTags] = useState(session.tags.join(", "));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = dialog.current!;
    const old = document.activeElement;
    d.showModal();
    usageApi
      .detail(session.key)
      .then(setSession)
      .catch(() => {});
    return () => {
      d.close();
      if (old instanceof HTMLElement) old.focus();
    };
  }, [session.key]);
  async function update(changes: Partial<Annotation>) {
    setBusy(true);
    try {
      const a: Annotation = {
        title: s.titleProvenance === "local" ? s.title : null,
        favorite: s.favorite,
        tags: s.tags,
        ...changes,
      };
      await usageApi.annotate(s.key, a);
      const next = await usageApi.detail(s.key);
      setSession(next);
      await u.invalidate();
      setEditing(false);
    } catch (e) {
      u.setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(summary = false) {
    try {
      await navigator.clipboard.writeText(
        summary
          ? `${s.title}\n${s.provider} · ${s.project}\nPeriod Est. API-equivalent cost: ${sessionPeriodCost(s, u.query.since, u.query.until) == null ? "Unavailable" : money(sessionPeriodCost(s, u.query.since, u.query.until)!)}\nLifetime Est. API-equivalent cost: ${money(s.costMicros)}${s.missingPricing ? " + unpriced usage" : ""}\nRecorded tokens: ${number(s.tokens.total)}\nSession ID: ${s.id}`
          : s.id,
      );
      u.setNotice(
        summary ? "Safe session summary copied." : "Session ID copied.",
      );
    } catch (e) {
      u.setNotice(errorMessage(e));
    }
  }
  const span = s.firstActivity
    ? Math.max(
        0,
        (new Date(s.lastActivity).getTime() -
          new Date(s.firstActivity).getTime()) /
          60000,
      )
    : null;
  const firstUsageDate = sessionFirstUsageDate(s, u.prefs.timezone);
  const activeDays = sessionActivityDays(s).length;
  return (
    <dialog
      ref={dialog}
      className="session-drawer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="session-detail-title"
    >
      <div className="drawer-content">
        <header className="drawer-toolbar">
          <span>
            <UIcon name="sessions" size={16} />
            Session details
          </span>
          <div>
            <button
              className={`icon-button ${s.favorite ? "is-favorite" : ""}`}
              aria-label={s.favorite ? "Remove favorite" : "Favorite session"}
              onClick={() => void update({ favorite: !s.favorite })}
              disabled={busy}
            >
              <UIcon name="star" size={17} />
            </button>
            <button
              className="icon-button"
              onClick={onClose}
              aria-label="Close session details"
            >
              <UIcon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="drawer-body">
          <ProviderMark provider={s.provider} label />
          <h2 id="session-detail-title">{s.title}</h2>
          <div className="drawer-title-source">
            <span className="subtle-badge">
              {s.titleProvenance === "local"
                ? "Local display override"
                : s.titleProvenance === "native"
                  ? "Provider-native title"
                  : s.titleProvenance === "prompt"
                    ? "Sanitized prompt fallback"
                    : "Identifier fallback"}
            </span>
            <button
              className="text-button"
              onClick={() => setEditing(!editing)}
            >
              Edit local title
            </button>
          </div>
          {editing && (
            <form
              className="local-title-form"
              onSubmit={(e) => {
                e.preventDefault();
                void update({ title: title.trim() || null });
              }}
            >
              <label>
                Only the app’s display title changes
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={s.nativeTitle || "Local display title"}
                  maxLength={160}
                />
              </label>
              <div className="button-row">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy}
                >
                  Save title
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setTitle("");
                    void update({ title: null });
                  }}
                >
                  Reset title
                </button>
              </div>
            </form>
          )}
          <div className="drawer-cost">
            <span title={periodCostDescription}>
              Est. API-equivalent cost
              <UIcon name="info" size={13} />
            </span>
            <strong>
              <PeriodCost
                value={sessionPeriodCost(s, u.query.since, u.query.until)}

                partial={s.missingPricing}
              />
            </strong>
            <small>
              {s.missingPricing
                ? "Known priced minimum + unpriced usage"
                : "Estimated token value · not a subscription bill"}
            </small>
          </div>
          <dl className="session-facts">
            <div>
              <dt title={lifetimeCostDescription}>Lifetime cost</dt>
              <dd title={lifetimeCostDescription}>
                {money(s.costMicros)}
                {s.missingPricing && " + unpriced usage"}
              </dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd title={s.projectPath}>
                <ProjectLabel path={s.projectPath}>{s.project}</ProjectLabel>
              </dd>
            </div>
            <div>
              <dt>First recorded usage</dt>
              <dd>
                {s.firstActivity
                  ? `${displayDate(dateKey(new Date(s.firstActivity), u.prefs.timezone))} · ${time(s.firstActivity, u.prefs.timezone)}`
                  : firstUsageDate
                    ? displayDate(firstUsageDate)
                    : "Unavailable"}
                {!s.firstActivity && firstUsageDate && (
                  <small>Exact time unavailable</small>
                )}
              </dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>
                {displayDate(
                  dateKey(new Date(s.lastActivity), u.prefs.timezone),
                )}{" "}
                · {time(s.lastActivity, u.prefs.timezone)}
              </dd>
            </div>
            <div>
              <dt>Elapsed span</dt>
              <dd>
                {span === null
                  ? "Unavailable"
                  : span < 60
                    ? `${Math.round(span)} minutes`
                    : `${(span / 60).toFixed(1)} hours`}
                <small>Not billable time</small>
              </dd>
            </div>
            <div>
              <dt>Active days</dt>
              <dd>{activeDays || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Source verification</dt>
              <dd>
                <span className="status-dot ok" />
                {u.view.data?.stale ? "Cached · stale" : s.sourceStatus}
              </dd>
            </div>
            <div>
              <dt>Cost mode</dt>
              <dd>{u.view.data?.costMode || "auto"} · offline pricing</dd>
            </div>
          </dl>
          <section className="drawer-section">
            <h3>
              Recorded tokens <strong>{compact(s.tokens.total)}</strong>
            </h3>
            <div className="drawer-token-grid">
              {(
                [
                  { key: "input", label: "Input" },
                  { key: "output", label: "Output" },
                  { key: "cacheRead", label: "Cache read" },
                  { key: "cacheCreation", label: "Cache creation" },
                ] as const
              ).map((t) => (
                <div key={t.key}>
                  <span>{t.label}</span>
                  <strong>{number(s.tokens[t.key])}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="drawer-section">
            <h3>Model breakdown</h3>
            {s.models.map((m) => (
              <div className="drawer-model" key={m.model}>
                <div>
                  <strong>{modelName(m.model)}</strong>
                  <small>
                    {compact(m.tokens.input)} input · {compact(m.tokens.output)}{" "}
                    output
                  </small>
                  {m.storedCostMicros !== null &&
                    m.storedCostMicros !== undefined && (
                      <small>Stored cost: {money(m.storedCostMicros)}</small>
                    )}
                  {m.isFallback && <small>Pricing fallback used</small>}
                </div>
                <strong>
                  <PeriodCost
                    value={sessionModelPeriodCost(
                      s,
                      m.model,
                      u.query.since,
                      u.query.until,
                    )}

                    partial={m.missingPricing}
                  />
                </strong>
              </div>
            ))}
          </section>
          <section className="drawer-section">
            <h3>Local tags</h3>
            <form
              className="tag-form"
              onSubmit={(e) => {
                e.preventDefault();
                void update({
                  tags: [
                    ...new Set(
                      tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ],
                });
              }}
            >
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Add tags, separated by commas"
                aria-label="Local tags"
              />
              <button
                className="secondary-button"
                type="submit"
                disabled={busy}
              >
                Save
              </button>
            </form>
          </section>
          <section className="drawer-section">
            <h3>Session ID</h3>
            <code className="session-full-id">{s.id}</code>
            <div className="drawer-actions">
              <button className="secondary-button" onClick={() => void copy()}>
                <UIcon name="copy" size={14} />
                Copy ID
              </button>
              <button
                className="secondary-button"
                onClick={() => void copy(true)}
              >
                <UIcon name="copy" size={14} />
                Copy summary
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  void usageApi
                    .open("project", s.key)
                    .catch((e) => u.setNotice(errorMessage(e)))
                }
                disabled={!s.projectPath}
              >
                <UIcon name="folder" size={14} />
                Open project
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  void usageApi
                    .open("source", s.key)
                    .catch((e) => u.setNotice(errorMessage(e)))
                }
                disabled={!s.sourcePath}
              >
                <UIcon name="external" size={14} />
                Reveal source
              </button>
            </div>
          </section>
          <p className="fine-print">
            <UIcon name="shield" size={13} />
            Titles, tags, and favorites stay in the app’s database. Provider
            files are read-only.
          </p>
        </div>
      </div>
    </dialog>
  );
}
