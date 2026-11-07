import test from "node:test";
import assert from "node:assert/strict";
import { createProjectIconLoader } from "../src/lib/project-icons.ts";

test("coalesces repeated labels and batches native snapshot reads", async () => {
  const calls = [];
  const icon = { kind: "gitlab", source: "GitLab repository" };
  const load = createProjectIconLoader(async (paths) => {
    calls.push(paths);
    return { "/repo": icon };
  });
  const first = load("/repo");
  assert.equal(load("/repo"), first);
  const missing = load("/missing");
  assert.deepEqual(await Promise.all([first, missing]), [icon, null]);
  assert.deepEqual(calls, [["/repo", "/missing"]]);
});

test("respects native batch bounds and recovers after a failed request", async () => {
  const sizes = [];
  const load = createProjectIconLoader(async (paths) => {
    sizes.push(paths.length);
    return {};
  });
  await Promise.all(Array.from({ length: 205 }, (_, i) => load(`/repo${i}`)));
  assert.deepEqual(sizes, [100, 100, 5]);
  let fail = true;
  const retry = createProjectIconLoader(async () => {
    if (fail) throw new Error("unavailable");
    return {};
  });
  await assert.rejects(retry("/repo"), /unavailable/);
  fail = false;
  assert.equal(await retry("/repo"), null);
});
