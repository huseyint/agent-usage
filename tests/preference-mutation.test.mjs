import test from "node:test";
import assert from "node:assert/strict";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  preferenceError,
  preferenceMutationOptions,
} from "../src/lib/preference-mutation.ts";
import { defaultPreferences } from "../src/lib/usage-types.ts";

function setup(t, save) {
  const client = new QueryClient();
  t.after(() => client.clear());
  let persisted = { ...defaultPreferences };
  client.setQueryData(["bootstrap"], { preferences: persisted });
  const options = preferenceMutationOptions(client, {
    bootstrap: async () => ({ preferences: persisted }),
    preferences: async (preferences) => {
      await save(preferences);
      persisted = preferences;
      return preferences;
    },
  });
  return {
    client,
    mutate: (changes) => new MutationObserver(client, options).mutate(changes),
    preferences: () => persisted,
  };
}

test("rapid edits save in order and merge with the latest committed preferences", async (t) => {
  const calls = [];
  let releaseFirst;
  const firstSave = new Promise((resolve) => (releaseFirst = resolve));
  const s = setup(t, async (preferences) => {
    calls.push(preferences);
    if (calls.length === 1) await firstSave;
  });
  const first = s.mutate({ theme: "dark" });
  const second = s.mutate({ weekStart: "sunday" });
  const third = s.mutate({ theme: "light" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.equal(calls[1].theme, "dark");
  assert.equal(calls[1].weekStart, "sunday");
  assert.equal(s.preferences().theme, "light");
  assert.equal(s.preferences().weekStart, "sunday");
  assert.deepEqual(
    s.client.getQueryData(["bootstrap"]).preferences,
    s.preferences(),
  );
});

test("a failed save does not block later edits or leak its rejected value", async (t) => {
  const s = setup(t, async (preferences) => {
    if (preferences.theme === "dark") throw new Error("Save failed");
  });
  const first = assert.rejects(s.mutate({ theme: "dark" }), /Save failed/);
  const second = s.mutate({ weekStart: "sunday" });
  await Promise.all([first, second]);
  assert.equal(s.preferences().theme, defaultPreferences.theme);
  assert.equal(s.preferences().weekStart, "sunday");
});

test("incomplete text and invalid allowances stay local while other fields can save", () => {
  for (const changes of [
    { timezone: "America/" },
    { timezone: "" },
    { enginePath: "" },
    { enginePath: "relative/path" },
    { claudeRoots: ["relative/path"] },
    { codexRoots: ["/path,with,commas"] },
    { claudeMonthlyAllowanceUsd: -10 },
    { codexMonthlyAllowanceUsd: NaN },
  ]) {
    assert.notEqual(preferenceError(changes), "");
  }
  for (const changes of [
    { timezone: "UTC" },
    { timezone: "local" },
    { timezone: "America/Chicago" },
    { enginePath: null },
    { enginePath: "/absolute/engine" },
    { claudeRoots: ["/first", "", "/second"] },
    { claudeMonthlyAllowanceUsd: null },
    { codexMonthlyAllowanceUsd: 100 },
    { theme: "dark" },
  ]) {
    assert.equal(preferenceError(changes), "");
  }
});
