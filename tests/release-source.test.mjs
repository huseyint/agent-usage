import test from "node:test";
import assert from "node:assert/strict";
import { planRelease } from "../scripts/release-source.mjs";
import { targets } from "../scripts/release.mjs";

function fixture() {
  const repository = "huseyint/agent-usage";
  const commit = "a".repeat(40);
  const previousTag = "b".repeat(40);
  const base = `repos/${repository}/actions/runs/123`;
  const responses = {
    [`repos/${repository}/releases/tags/v0.1.1`]: { draft: false },
    [`repos/${repository}/git/ref/tags/v0.1.1`]: {
      object: { sha: previousTag },
    },
    [base]: {
      status: "completed",
      path: ".github/workflows/release.yml",
      event: "workflow_dispatch",
      repository: { full_name: repository },
      head_repository: { full_name: repository },
      head_sha: commit,
    },
    [`${base}/jobs?per_page=100`]: {
      jobs: [
        "validate",
        "build / matrix",
        ...targets.map(({ label }) => `build / ${label}`),
      ].map((name) => ({ name, conclusion: "success" })),
    },
    [`${base}/artifacts?per_page=100`]: {
      artifacts: targets.map(({ target }) => ({
        name: `release-${target}`,
        expired: false,
      })),
    },
  };
  return {
    responses,
    base,
    options: {
      repository,
      tag: "v0.1.1",
      event: "workflow_dispatch",
      workflowCommit: commit,
      replacePublished: true,
      artifactRun: "",
      canMoveTag: true,
      gh: ([, path]) => {
        assert.ok(path in responses, path);
        return JSON.stringify(responses[path]);
      },
      git: () => commit,
    },
  };
}

test("replacement fails before building or uploading when tag credentials are missing", () => {
  const { options } = fixture();
  assert.throws(
    () => planRelease({ ...options, canMoveTag: false }),
    /Configure RELEASE_TAG_SSH_KEY/,
  );
});

test("an already correct tag can be republished without extra credentials", () => {
  const { options, responses } = fixture();
  responses[
    `repos/${options.repository}/git/ref/tags/${options.tag}`
  ].object.sha = options.workflowCommit;
  assert.equal(
    planRelease({ ...options, canMoveTag: false }).commit,
    options.workflowCommit,
  );
});

test("tag push after replacement skips duplicate builds and publication", () => {
  const { options } = fixture();
  assert.deepEqual(
    planRelease({ ...options, event: "push", replacePublished: false }),
    { skip: "true" },
  );
});

test("publication recovery reuses the artifact run source, not current workflow code", () => {
  const { options } = fixture();
  const plan = planRelease({
    ...options,
    workflowCommit: "c".repeat(40),
    artifactRun: "123",
  });
  assert.equal(plan.commit, "a".repeat(40));
  assert.equal(plan.skip, "false");
});

test("recovery rejects untrusted, incomplete or unrelated workflow runs", () => {
  for (const patch of [
    { status: "in_progress" },
    { event: "pull_request" },
    { repository: { full_name: "another/repo" } },
    { head_repository: { full_name: "another/fork" } },
    { path: ".github/workflows/check.yml" },
    { head_sha: "invalid" },
  ]) {
    const { options, responses, base } = fixture();
    Object.assign(responses[base], patch);
    assert.throws(() => planRelease({ ...options, artifactRun: "123" }));
  }
});

test("recovery requires all native build jobs to have passed", () => {
  for (const target of targets) {
    const { options, responses, base } = fixture();
    responses[`${base}/jobs?per_page=100`].jobs.find(
      ({ name }) => name === `build / ${target.label}`,
    ).conclusion = "failure";
    assert.throws(
      () => planRelease({ ...options, artifactRun: "123" }),
      /no successful job/,
    );
  }
});

test("ordinary draft recovery rejects artifacts from a different tagged source", () => {
  const { options, responses, base } = fixture();
  responses[`repos/${options.repository}/releases/tags/${options.tag}`].draft =
    true;
  responses[base].head_sha = "c".repeat(40);
  assert.throws(
    () =>
      planRelease({ ...options, replacePublished: false, artifactRun: "123" }),
    /does not match the version tag/,
  );
});

test("recovery rejects missing, duplicate and expired target artifacts", () => {
  for (const mutate of [
    (artifacts) => artifacts.pop(),
    (artifacts) => artifacts.push(artifacts[0]),
    (artifacts) => {
      artifacts[0].expired = true;
    },
  ]) {
    const { options, responses, base } = fixture();
    mutate(responses[`${base}/artifacts?per_page=100`].artifacts);
    assert.throws(
      () => planRelease({ ...options, artifactRun: "123" }),
      /every supported target/,
    );
  }
});

test("new releases accept a missing release but propagate authentication failures", () => {
  const { options } = fixture();
  for (const status of [404, 403]) {
    const gh = (args) => {
      if (args[1].includes("releases/tags")) {
        const error = Error("API failed");
        error.stdout = JSON.stringify({ status });
        throw error;
      }
      return options.gh(args);
    };
    const run = () => planRelease({ ...options, replacePublished: false, gh });
    if (status === 404) assert.equal(run().commit, options.workflowCommit);
    else assert.throws(run, /API failed/);
  }
});
