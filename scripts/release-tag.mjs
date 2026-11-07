import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export function moveReleaseTag({
  repository,
  tag,
  commit,
  previousTag,
  privateKey = process.env.RELEASE_TAG_SSH_KEY,
  gh,
  runGit = (args, options) => execFileSync("git", args, options),
}) {
  if (previousTag === commit) return;
  if (!privateKey) {
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${repository}/git/refs/tags/${encodeURIComponent(tag)}`,
      "-f",
      `sha=${commit}`,
      "-F",
      "force=true",
    ]);
    return;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw Error("Invalid release repository.");
  const directory = mkdtempSync(
    join(process.env.RUNNER_TEMP || tmpdir(), "agent-usage-release-key-"),
  );
  try {
    const identity = join(directory, "identity");
    const knownHosts = join(directory, "known_hosts");
    writeFileSync(identity, privateKey.trim() + "\n", { mode: 0o600 });
    const { ssh_keys: keys } = JSON.parse(gh(["api", "meta"]));
    if (!Array.isArray(keys) || !keys.length)
      throw Error("GitHub SSH host keys are unavailable.");
    writeFileSync(
      knownHosts,
      keys.map((key) => `github.com ${key}\n`).join(""),
    );
    runGit(
      [
        "push",
        `--force-with-lease=refs/tags/${tag}:${previousTag}`,
        `git@github.com:${repository}.git`,
        `${commit}:refs/tags/${tag}`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
        GIT_SSH_COMMAND: `ssh -F /dev/null -i ${quote(identity)} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(knownHosts)}`,
        },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
