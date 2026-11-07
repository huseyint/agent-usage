import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { prepareRelease } from "../scripts/draft-release.mjs";
import {
  checkVersion,
  releaseAssets,
  retiredReleaseAssets,
  root,
  targets,
} from "../scripts/release.mjs";

function fixture(t, { published = true, assets = [] } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "agent-usage-publish-"));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const write = (path, value) => {
    const destination = join(projectRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  };
  for (const path of [
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ])
    write(path, readFileSync(join(root, path)));
  const version = checkVersion(projectRoot);
  const tag = `v${version}`;
  const commit = "a".repeat(40);
  const previousTag = "b".repeat(40);
  const manifest = {
    version,
    builds: targets.map(({ target, platform }) => ({
      target,
      platform,
      commit,
      signing: "unsigned",
    })),
  };
  write(
    ".cache/github-release/release-manifest.json",
    JSON.stringify(manifest),
  );
  write(`docs/releases/${version}.md`, "Release introduction.\n");
  const calls = [];
  const options = {
    tag,
    projectRoot,
    repository: "huseyint/agent-usage",
    commit,
    previousTag,
    replacePublished: false,
    runGh: (args) => {
      calls.push(args);
      if (args[0] === "release" && args[1] === "list")
        return JSON.stringify(
          published === null ? [] : [{ tagName: tag, isDraft: !published }],
        );
      if (args[0] === "release" && args[1] === "view")
        return JSON.stringify({ assets });
      if (args[0] === "api" && args[1].startsWith("repos/"))
        return JSON.stringify({ object: { sha: previousTag } });
      return "";
    },
  };
  return { options, calls, manifest, write };
}

test("published releases are preserved unless replacement is explicitly enabled", (t) => {
  const { options, calls } = fixture(t);
  assert.throws(
    () => prepareRelease(options),
    /Refusing to modify published release/,
  );
  assert.equal(calls.length, 1);
});

test("ordinary releases are uploaded as drafts without changing the tag", (t) => {
  for (const published of [false, null]) {
    const { options, calls } = fixture(t, { published });
    prepareRelease(options);
    assert.ok(calls.some((args) => args[1] === "upload"));
    assert.ok(calls.find((args) => args[1] === "edit").includes("--draft"));
    assert.ok(!calls.some((args) => args[0] === "api"));
    assert.equal(
      calls.some((args) => args[1] === "create"),
      published === null,
    );
  }
});

test("explicit replacement uploads all assets before retagging and keeps the release published", (t) => {
  const { options, calls } = fixture(t);
  prepareRelease({ ...options, replacePublished: true });
  const uploads = calls.filter((args) => args[1] === "upload");
  assert.equal(
    uploads.flatMap((args) => args.slice(3, -1)).length,
    releaseAssets(checkVersion(options.projectRoot)).length,
  );
  assert.ok(uploads.every((args) => args.includes("--clobber")));
  const retag = calls.findIndex((args) => args.includes("PATCH"));
  assert.ok(retag > calls.indexOf(uploads.at(-1)));
  assert.ok(calls[retag].includes(`sha=${options.commit}`));
  assert.ok(!calls.find((args) => args[1] === "edit").includes("--draft"));
  assert.ok(!calls.some((args) => args[1] === "create"));
});

test("replacement rejects a source mismatch before modifying the release", (t) => {
  const { options, calls, manifest, write } = fixture(t);
  manifest.builds[0].commit = "c".repeat(40);
  write(
    ".cache/github-release/release-manifest.json",
    JSON.stringify(manifest),
  );
  assert.throws(
    () => prepareRelease({ ...options, replacePublished: true }),
    /source commit/,
  );
  assert.equal(calls.length, 1);
});

test("retrying publication does not update an already correct tag", (t) => {
  const { options, calls } = fixture(t);
  const runGh = options.runGh;
  prepareRelease({
    ...options,
    replacePublished: true,
    previousTag: options.commit,
    runGh: (args) => {
      if (args[0] === "api" && args[1].startsWith("repos/"))
        return JSON.stringify({ object: { sha: options.commit } });
      return runGh(args);
    },
  });
  assert.ok(calls.some((args) => args[1] === "upload"));
  assert.ok(calls.some((args) => args[1] === "edit"));
  assert.ok(!calls.some((args) => args.includes("PATCH")));
});

test("replacement rejects a tag changed during the build", (t) => {
  const { options, calls } = fixture(t);
  assert.throws(
    () =>
      prepareRelease({
        ...options,
        replacePublished: true,
        previousTag: "c".repeat(40),
      }),
    /tag changed while building/,
  );
  assert.ok(
    !calls.some((args) => args[1] === "upload" || args.includes("PATCH")),
  );
});

test("replacement preserves unexpected existing assets", (t) => {
  const { options, calls } = fixture(t, {
    assets: [{ name: "manual-notes.txt" }],
  });
  assert.throws(
    () => prepareRelease({ ...options, replacePublished: true }),
    /unexpected assets/,
  );
  assert.ok(
    !calls.some((args) => args[1] === "upload" || args.includes("PATCH")),
  );
});

test("retired platform downloads are removed only after current assets are uploaded", (t) => {
  const retiredNames = retiredReleaseAssets(checkVersion());
  assert.equal(retiredNames.length, 6);
  for (const published of [true, false]) {
    const { options, calls } = fixture(t, {
      published,
      assets: [...retiredNames, ...releaseAssets(checkVersion())].map(
        (name) => ({ name }),
      ),
    });
    prepareRelease({ ...options, replacePublished: published });
    const deletions = calls.filter((args) => args[1] === "delete-asset");
    assert.deepEqual(
      deletions.map((args) => args[3]).sort(),
      [...retiredNames].sort(),
    );
    const lastUpload = calls.findLastIndex((args) => args[1] === "upload");
    assert.ok(
      deletions.every(
        (args) => calls.indexOf(args) > lastUpload && args.includes("--yes"),
      ),
    );
    assert.ok(
      !deletions.some((args) =>
        releaseAssets(checkVersion()).includes(args[3]),
      ),
    );
  }
});

test("failed uploads do not move the release tag", (t) => {
  const { options, calls } = fixture(t, {
    assets: retiredReleaseAssets(checkVersion()).map((name) => ({ name })),
  });
  const runGh = options.runGh;
  assert.throws(
    () =>
      prepareRelease({
        ...options,
        replacePublished: true,
        runGh: (args) => {
          if (args[1] === "upload") throw Error("Upload failed");
          return runGh(args);
        },
      }),
    /Upload failed/,
  );
  assert.ok(
    !calls.some(
      (args) =>
        args.includes("PATCH") ||
        args[1] === "edit" ||
        args[1] === "delete-asset",
    ),
  );
});
