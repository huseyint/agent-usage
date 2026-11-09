import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { targets } from "./release.mjs";

export function planRelease({
  repository = process.env.GITHUB_REPOSITORY,
  tag = process.env.RELEASE_TAG,
  event = process.env.GITHUB_EVENT_NAME,
  workflowCommit = process.env.GITHUB_SHA,
  replacePublished = process.env.REPLACE_PUBLISHED === "true",
  artifactRun = process.env.RELEASE_ARTIFACT_RUN,
  canMoveTag = process.env.RELEASE_CAN_MOVE_TAG === "true",
  gh = (args) => execFileSync("gh", args, { encoding: "utf8" }),
  git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim(),
} = {}) {
  if (
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag || "")
  )
    throw Error("A valid version tag is required.");
  const api = (path) => JSON.parse(gh(["api", path]));
  let release;
  try {
    release = api(`repos/${repository}/releases/tags/${tag}`);
  } catch (error) {
    let status;
    try {
      status = JSON.parse(error.stdout?.toString()).status;
    } catch {}
    if (Number(status) !== 404) throw error;
  }
  // A deploy-key tag update triggers a push run. Its release is already published.
  if (event === "push" && release && !release.draft) return { skip: "true" };
  if (release && !release.draft && !replacePublished)
    throw Error("Published releases require replace_published=true.");
  if (replacePublished && (!release || release.draft))
    throw Error("Replacement requires an existing published release.");

  let commit = replacePublished
    ? workflowCommit
    : git(["rev-parse", `refs/tags/${tag}^{commit}`]);
  if (artifactRun) {
    if (!/^\d+$/.test(artifactRun)) throw Error("Invalid artifact run ID.");
    const base = `repos/${repository}/actions/runs/${artifactRun}`;
    const run = api(base);
    if (
      run.status !== "completed" ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository ||
      run.path?.split("@")[0] !== ".github/workflows/release.yml" ||
      !["push", "workflow_dispatch"].includes(run.event)
    )
      throw Error(
        "Artifacts must come from a completed release run in this repository.",
      );
    const { jobs } = api(`${base}/jobs?per_page=100`);
    for (const name of [
      "validate",
      "build / matrix",
      ...targets.map(({ label }) => `build / ${label}`),
    ]) {
      if (
        !jobs.some((job) => job.name === name && job.conclusion === "success")
      )
        throw Error(`Artifact run has no successful job: ${name}`);
    }
    const { artifacts } = api(`${base}/artifacts?per_page=100`);
    const expected = targets.map(({ target }) => `release-${target}`).sort();
    const available = artifacts.filter(({ name }) =>
      name.startsWith("release-"),
    );
    if (
      available.some(({ expired }) => expired) ||
      JSON.stringify(available.map(({ name }) => name).sort()) !==
        JSON.stringify(expected)
    )
      throw Error(
        "Artifact run must contain every supported target exactly once, without expired artifacts.",
      );
    if (!replacePublished && commit !== run.head_sha)
      throw Error("Artifact source does not match the version tag.");
    commit = run.head_sha;
  }
  if (!/^[a-f0-9]{40}$/.test(commit || ""))
    throw Error("Invalid release source commit.");
  const { object } = api(`repos/${repository}/git/ref/tags/${tag}`);
  if (replacePublished && object.sha !== commit && !canMoveTag)
    throw Error(
      "Configure RELEASE_TAG_SSH_KEY or RELEASE_TOKEN before replacing a tag. No release assets were modified.",
    );
  return { skip: "false", tag, commit, "previous-tag": object.sha };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const plan = planRelease();
  if (process.env.GITHUB_OUTPUT)
    for (const [key, value] of Object.entries(plan))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  else console.log(JSON.stringify(plan));
}
