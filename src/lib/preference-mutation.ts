import type { QueryClient } from "@tanstack/react-query";
import type { Bootstrap, Preferences } from "./usage-types.ts";
import { validMonthlyAllowance } from "./monthly-allowance.ts";

export function preferenceMutationOptions(
  client: QueryClient,
  api: {
    bootstrap: () => Promise<Bootstrap>;
    preferences: (preferences: Preferences) => Promise<Preferences>;
  },
) {
  return {
    scope: { id: "preferences" },
    mutationFn: async (changes: Partial<Preferences>) => {
      const bootstrap = await client.ensureQueryData({
        queryKey: ["bootstrap"],
        queryFn: api.bootstrap,
      });
      return api.preferences({ ...bootstrap.preferences, ...changes });
    },
    onSuccess: (preferences: Preferences) => {
      client.setQueryData<Bootstrap>(["bootstrap"], (bootstrap) =>
        bootstrap ? { ...bootstrap, preferences } : bootstrap,
      );
    },
  };
}

export function preferenceError(changes: Partial<Preferences>) {
  for (const value of [
    changes.claudeMonthlyAllowanceUsd,
    changes.codexMonthlyAllowanceUsd,
  ]) {
    if (!validMonthlyAllowance(value))
      return "Enter a positive USD amount or leave blank.";
  }
  if (changes.timezone !== undefined && changes.timezone !== "local") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: changes.timezone });
    } catch {
      return "Choose a valid IANA timezone.";
    }
  }
  const absolute = (path: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
  if (changes.enginePath != null && !absolute(changes.enginePath))
    return "Choose an absolute executable path, or switch to the bundled engine.";
  if (
    [...(changes.claudeRoots ?? []), ...(changes.codexRoots ?? [])].some(
      (root) => root && (!absolute(root) || root.includes(",")),
    )
  )
    return "Source roots must be absolute paths without commas.";
  return "";
}
