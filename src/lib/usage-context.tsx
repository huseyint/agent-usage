import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useLocation } from "react-router";
import { isDesktop } from "./desktop";
import { usageApi, errorMessage } from "./usage-api";
import {
  defaultPreferences,
  defaultQuery,
  type Preferences,
  type Query,
  type Session,
} from "./usage-types";
import { rangeDates } from "./format";
import { usePreferences } from "./preferences";
import { useSessionActivity } from "./use-session-activity";
import { useSessionVisits } from "./use-session-visits";
import { sessionQueryOptions } from "./session-query";
import { monthlyAllowanceOptions } from "./monthly-allowance";
import { useCurrentDay } from "./use-current-day";
import { preferenceMutationOptions } from "./preference-mutation";
function useUsageState() {
  const client = useQueryClient();
  const location = useLocation();
  const [range, setRange] = useState("30d");
  const [provider, setProvider] = useState("all");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [filters, setFilters] = useState<Query>(defaultQuery);
  const [selected, setSelected] = useState<Session | null>(null);
  const [notice, setNotice] = useState<ReactNode>("");
  const [dayOverride, setDayOverride] = useState<string | null>(null);
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: usageApi.bootstrap,
  });
  const prefs = bootstrap.data?.preferences || defaultPreferences;
  const today = useCurrentDay(prefs.timezone);
  const monthlyUsage = useQuery({
    ...monthlyAllowanceOptions(today, prefs.timezone, usageApi.view),
    enabled:
      !!bootstrap.data?.hasSnapshot &&
      (prefs.claudeMonthlyAllowanceUsd != null ||
        prefs.codexMonthlyAllowanceUsd != null),
  });
  useEffect(() => {
    if (bootstrap.data) {
      usePreferences.getState().setTheme(bootstrap.data.preferences.theme);
      setRange(bootstrap.data.preferences.defaultRange);
    }
  }, [
    bootstrap.data?.preferences.defaultRange,
    bootstrap.data?.preferences.theme,
  ]);
  const [since, until] = rangeDates(
    range,
    prefs.timezone,
    customSince,
    customUntil,
  );
  const isSessions = location.pathname === "/sessions";
  const query = useMemo<Query>(
    () => ({
      ...defaultQuery,
      ...(isSessions ? filters : {}),
      providers: provider === "all" ? [] : [provider],
      since: dayOverride || since,
      until: dayOverride || until,
      weekStart: prefs.weekStart,
    }),
    [isSessions, filters, provider, since, until, dayOverride, prefs.weekStart],
  );
  const reportView = useQuery({
    queryKey: ["usage", query],
    queryFn: () => usageApi.view(query),
    enabled: !isSessions && !!bootstrap.data?.hasSnapshot,
    placeholderData: (previous) => previous,
  });
  const sessionsView = useInfiniteQuery({
    ...sessionQueryOptions(query, usageApi.view),
    enabled: isSessions && !!bootstrap.data?.hasSnapshot,
  });
  const view = isSessions ? sessionsView : reportView;
  const sessionKeys =
    (isSessions
      ? sessionsView.data?.sessions
      : reportView.data?.topSessions
    )?.map((s) => s.key) || [];
  const sessionActivity = useSessionActivity(
    sessionKeys,
    isSessions || location.pathname === "/",
  );
  const isNewSession = useSessionVisits(
    sessionKeys,
    isSessions || location.pathname === "/",
    view.dataUpdatedAt,
  );
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["bootstrap"] });
    await client.invalidateQueries({ queryKey: ["usage"] });
  };
  const refresh = useMutation({
    mutationFn: usageApi.refresh,
    onSuccess: invalidate,
    onError: async (e) => {
      if (!(
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "REFRESH_BUSY"
      ))
        setNotice(errorMessage(e));
      await invalidate();
    },
  });
  const preferenceOptions = preferenceMutationOptions(client, usageApi);
  const savePreferences = useMutation({
    ...preferenceOptions,
    onSuccess: async (p: Preferences) => {
      preferenceOptions.onSuccess(p);
      usePreferences.getState().setTheme(p.theme);
      await invalidate();
    },
    onError: (e) => setNotice(errorMessage(e)),
  });
  useEffect(() => {
    if (!isDesktop) return;
    const listeners = Promise.all([
      listen("usage-updated", () => {
        void invalidate();
      }),
      listen("usage-refreshing", () => {
        void client.invalidateQueries({ queryKey: ["bootstrap"] });
      }),
    ]);
    return () => {
      void listeners.then((ls) => ls.forEach((l) => l()));
    };
  }, []);
  useEffect(() => {
    if (
      !isDesktop ||
      !bootstrap.data?.preferences.onboarded ||
      bootstrap.data.hasSnapshot
    )
      return;
    refresh.mutate();
  }, [bootstrap.data?.preferences.onboarded]);
  const updateFilters = (changes: Partial<Query>) =>
    setFilters((f) => ({ ...f, ...changes, offset: changes.offset ?? 0 }));
  function reset() {
    setFilters(defaultQuery);
    setProvider("all");
    setDayOverride(null);
    setRange(prefs.defaultRange);
  }
  return {
    bootstrap,
    isNewSession,
    sessionActivity,
    prefs,
    monthlyUsage,
    view,
    sessionsView,
    query,
    filters,
    updateFilters,
    provider,
    setProvider,
    range,
    setRange: (r: string) => {
      setRange(r);
      setDayOverride(null);
      setFilters((f) => ({ ...f, offset: 0 }));
    },
    customSince,
    setCustomSince,
    customUntil,
    setCustomUntil,
    selected,
    setSelected,
    notice,
    setNotice,
    refresh,
    savePreferences,
    invalidate,
    dayOverride,
    setDayOverride,
    reset,
  };
}
type UsageContext = ReturnType<typeof useUsageState>;
// Keep the context identity stable when Vite refreshes this module during development.
const Context: import("react").Context<UsageContext | null> =
  import.meta.hot?.data.usageContext ??
  createContext<UsageContext | null>(null);
if (import.meta.hot) import.meta.hot.data.usageContext = Context;
export function UsageProvider({ children }: { children: ReactNode }) {
  const value = useUsageState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useUsage() {
  const value = useContext(Context);
  if (!value) throw new Error("Usage provider missing");
  return value;
}
