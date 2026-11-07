import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { activityCalendar, activityQuery } from "@/lib/activity-calendar";
import { dateKey, displayDate, money, number } from "@/lib/format";
import { millisecondsUntilNextDay } from "@/lib/day-clock";
import { usageApi } from "@/lib/usage-api";
import { useUsage } from "@/lib/usage-context";
import { Panel } from "./usage-components";

export function DailyActivity() {
  const u = useUsage();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const today = dateKey(new Date(now), u.prefs.timezone);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setTimeout(
      update,
      millisecondsUntilNextDay(Date.now(), u.prefs.timezone),
    );
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
    };
  }, [today, u.prefs.timezone]);
  const query = activityQuery(today, u.query.providers, u.prefs.weekStart);
  const activity = useQuery({
    queryKey: ["usage", "activity", query, u.prefs.timezone, u.prefs.costMode],
    queryFn: () => usageApi.view(query),
    enabled: !!u.bootstrap.data?.hasSnapshot,
  });
  const calendar = activityCalendar(
    activity.data?.daily || [],
    today,
    u.prefs.weekStart,
  );
  const weekdays =
    u.prefs.weekStart === "monday"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Panel
      title="Daily activity"
      className="daily-activity-panel"
      actions={
        <span
          className="subtle-badge"
          title={`52 complete weeks: ${query.since} through ${query.until}`}
        >
          Last 52 full weeks
        </span>
      }
    >
      <div className="activity-heatmap" aria-busy={activity.isPending}>
        {activity.isError ? (
          <p className="heatmap-status" role="alert">
            Could not load activity for the last 52 full weeks.{" "}
            <button
              className="text-button"
              onClick={() => void activity.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <>
            <div className="heatmap-scroll">
              <div
                className="heatmap-calendar"
                role="group"
                aria-label={`Daily activity from ${query.since} through ${query.until}`}
                style={
                  { "--heatmap-weeks": calendar.weekCount } as CSSProperties
                }
              >
                {calendar.months.map((month) => (
                  <span
                    className="heatmap-month"
                    key={month.date}
                    style={{
                      gridColumn: `${month.column} / span 3`,
                      gridRow: 1,
                    }}
                  >
                    {month.label}
                  </span>
                ))}
                {weekdays.map((day, index) =>
                  ["Mon", "Wed", "Fri"].includes(day) ? (
                    <span
                      className="heatmap-weekday"
                      key={day}
                      style={{ gridColumn: 1, gridRow: index + 2 }}
                    >
                      {day}
                    </span>
                  ) : null,
                )}
                {calendar.days.map((day) => {
                  const description = `${displayDate(day.date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })} · ${money(day.costMicros)} estimated usage · ${number(day.tokens)} tokens`;
                  return (
                    <button
                      className="heatmap-cell"
                      key={day.date}
                      data-level={activity.isPending ? 0 : day.level}
                      disabled={activity.isPending}
                      title={description}
                      aria-label={`${description}. Explore sessions`}
                      style={{ gridColumn: day.column, gridRow: day.row }}
                      onClick={() => {
                        u.setDayOverride(day.date);
                        navigate("/sessions");
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="heatmap-caption">
              <span aria-live="polite">
                {activity.isPending
                  ? "Loading activity…"
                  : `${calendar.activeDays} active days in the last 52 full weeks`}
              </span>
              <span
                className="heatmap-legend"
                aria-label="Estimated usage: less to more"
              >
                Less
                {[0, 1, 2, 3, 4].map((level) => (
                  <i
                    key={level}
                    className="heatmap-cell"
                    data-level={level}
                    aria-hidden="true"
                  />
                ))}
                More
              </span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
