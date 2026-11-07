import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usageApi } from "./usage-api";
import { useWindowVisible } from "./use-window-visible";
import { activityStatus } from "./session-activity";

export function useSessionActivity(keys: string[], enabled = true) {
  const visible = useWindowVisible();
  const [now, setNow] = useState(Date.now());
  const requested = [...new Set(keys)].sort().slice(0, 500);
  const query = useQuery({
    queryKey: ["session-activity", requested],
    queryFn: () => usageApi.activity(requested),
    enabled: visible && enabled && requested.length > 0,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  useEffect(() => {
    const clock = Date.now();
    const nextExpiry = Math.min(
      ...Object.values(query.data || {})
        .map((activity) => Date.parse(activity.expiresAt))
        .filter((expires) => expires > clock),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      nextExpiry - clock + 1,
    );
    return () => window.clearTimeout(timer);
  }, [query.data, now]);
  return (key: string) =>
    enabled && !query.isError
      ? activityStatus(query.data?.[key], Math.max(now, Date.now()))
      : undefined;
}
