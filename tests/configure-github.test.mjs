import assert from "node:assert/strict";
import test from "node:test";
import { configureGithub } from "../scripts/configure-github.mjs";

function github(visibility, failPath) {
  const calls = [];
  const gh = (args, options) => {
    const method = args[2];
    const path = args[3];
    const body = options.input ? JSON.parse(options.input) : undefined;
    calls.push({ method, path, body });
    if (method === "GET")
      return JSON.stringify({ visibility, permissions: { admin: true } });
    if (path.endsWith(failPath || "never-match"))
      throw Error("GitHub rejected setting");
    return "";
  };
  return { calls, gh };
}

test("configures available private settings and defers public features without changing visibility", () => {
  const client = github("private");
  const result = configureGithub(client);
  assert.equal(result.applied.length, 3);
  assert.equal(result.pending.length, 4);
  assert.deepEqual(result.failures, []);
  assert.equal(
    client.calls.filter(({ method }) => method === "PATCH").length,
    0,
  );
  assert.ok(client.calls.every(({ body }) => !body || !("visibility" in body)));
});

test("public protection preserves solo direct pushes and requires approval for external workflows", () => {
  const client = github("public");
  const result = configureGithub(client);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.failures, []);
  const protection = client.calls.find(({ path }) =>
    path.endsWith("/protection"),
  ).body;
  assert.equal(protection.enforce_admins, true);
  assert.equal(protection.allow_force_pushes, false);
  assert.equal(protection.allow_deletions, false);
  assert.equal(protection.required_pull_request_reviews, null);
  assert.equal(protection.required_status_checks, null);
  assert.equal(
    client.calls.find(({ path }) =>
      path.endsWith("/fork-pr-contributor-approval"),
    ).body.approval_policy,
    "all_external_contributors",
  );
  assert.ok(client.calls.every(({ body }) => !body || !("visibility" in body)));
});

test("reports individual failures while applying independent protections", () => {
  const client = github("public", "/private-vulnerability-reporting");
  const result = configureGithub(client);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].name, "Private vulnerability reporting");
  assert.equal(result.applied.length, 6);
  assert.ok(client.calls.some(({ path }) => path.endsWith("/protection")));
});
