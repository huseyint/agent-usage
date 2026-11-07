import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { moveReleaseTag } from "../scripts/release-tag.mjs";

test("an already correct release tag needs no write credentials", () => {
  moveReleaseTag({
    commit: "a".repeat(40),
    previousTag: "a".repeat(40),
    gh: () => assert.fail("Unexpected API call"),
    runGit: () => assert.fail("Unexpected Git call"),
  });
});

test("deploy-key retagging uses a lease, verified host keys and temporary credentials", () => {
  for (const fail of [false, true]) {
    let identity;
    let knownHosts;
    const push = () =>
      moveReleaseTag({
        repository: "huseyint/agent-usage",
        tag: "v0.1.1",
        commit: "a".repeat(40),
        previousTag: "b".repeat(40),
        privateKey: "test-private-key",
        gh: (args) => {
          assert.deepEqual(args, ["api", "meta"]);
          return JSON.stringify({ ssh_keys: ["ssh-ed25519 test-host-key"] });
        },
        runGit: (args, { env }) => {
          assert.deepEqual(args, [
            "push",
            `--force-with-lease=refs/tags/v0.1.1:${"b".repeat(40)}`,
            "git@github.com:huseyint/agent-usage.git",
            `${"a".repeat(40)}:refs/tags/v0.1.1`,
          ]);
          identity = env.GIT_SSH_COMMAND.match(/-i '([^']+)'/)[1];
          knownHosts = env.GIT_SSH_COMMAND.match(
            /UserKnownHostsFile='([^']+)'/,
          )[1];
          assert.equal(readFileSync(identity, "utf8"), "test-private-key\n");
          if (process.platform !== "win32")
            assert.equal(statSync(identity).mode & 0o777, 0o600);
          assert.equal(
            readFileSync(knownHosts, "utf8"),
            "github.com ssh-ed25519 test-host-key\n",
          );
          assert.match(env.GIT_SSH_COMMAND, /StrictHostKeyChecking=yes/);
          assert.match(env.GIT_SSH_COMMAND, /IdentityAgent=none/);
          if (fail) throw Error("Push rejected: stale lease");
        },
      });
    if (fail) assert.throws(push, /stale lease/);
    else push();
    assert.ok(!existsSync(identity));
    assert.ok(!existsSync(knownHosts));
  }
});
