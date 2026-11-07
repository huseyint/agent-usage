import type { SessionActivity } from "@/lib/session-activity";

export function SessionActivityBadge({
  state,
}: {
  state: SessionActivity["state"] | undefined;
}) {
  if (!state) return null;
  const working = state === "working";
  return (
    <span
      className={`session-activity-badge ${state}`}
      title={
        working
          ? "A turn has started and its log is still active. No completion has been recorded. Expires after 2 minutes without activity."
          : "Prompt or agent activity recorded within 45 seconds. Running status is inferred; this does not detect typing."
      }
    >
      <span className="session-activity-dot" aria-hidden="true" />
      {working ? "Working" : "Recent"}
    </span>
  );
}
