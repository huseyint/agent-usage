export interface SessionActivity {
  state: "working" | "recent";
  observedAt: string;
  expiresAt: string;
}

export function activityStatus(
  activity: SessionActivity | undefined,
  now = Date.now(),
) {
  if (!activity || !["working", "recent"].includes(activity.state))
    return undefined;
  const observed = Date.parse(activity.observedAt);
  const expires = Date.parse(activity.expiresAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    observed > now + 5000 ||
    expires <= now
  )
    return undefined;
  return activity.state;
}
