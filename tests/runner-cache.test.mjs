import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  cachePaths,
  cleanBundles,
  pnpmReady,
} from "../scripts/runner-cache.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "runner-cache-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path, content = "synthetic") => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  return { dir, write };
}

test("main and release tags reuse caches while PRs and branches have separate directories", (t) => {
  const { dir } = fixture(t);
  const options = {
    toolCache: dir,
    ref: "refs/heads/main",
    target: "x86_64-pc-windows-msvc",
    packageManager: "pnpm@12.11.2",
  };
  const main = cachePaths(options);
  assert.equal(
    cachePaths({ ...options, ref: "refs/tags/v0.1.1" }).root,
    main.root,
  );
  assert.notEqual(
    cachePaths({ ...options, event: "pull_request", ref: "refs/pull/2/merge" })
      .root,
    main.root,
  );
  assert.notEqual(
    cachePaths({ ...options, ref: "refs/heads/feature" }).root,
    main.root,
  );
  assert.notEqual(
    cachePaths({ ...options, target: "aarch64-apple-darwin" }).app,
    main.app,
  );
  assert.notEqual(
    cachePaths({ ...options, packageManager: "pnpm@12.11.3" }).pnpm,
    main.pnpm,
  );
  assert.ok(
    cachePaths({
      ...options,
      volumeRoot: join(dir, "volume"),
    }).cargo.startsWith(join(dir, "volume")),
  );
});

test("partial or mismatched pnpm installs are never reused", (t) => {
  const { dir, write } = fixture(t);
  const paths = cachePaths({
    toolCache: dir,
    target: "x86_64-pc-windows-msvc",
    packageManager: "pnpm@12.11.2",
  });
  write(
    join(paths.pnpm, "node_modules/pnpm/package.json"),
    JSON.stringify({ version: paths.version }),
  );
  write(join(paths.pnpmBin, "pnpm"));
  write(join(paths.pnpmBin, "pnpm.cmd"));
  assert.equal(pnpmReady(paths), false);
  write(join(paths.pnpm, ".complete"), paths.version);
  assert.equal(pnpmReady(paths, "win32"), true);
  assert.equal(pnpmReady(paths, "linux"), true);
  write(
    join(paths.pnpm, "node_modules/pnpm/package.json"),
    JSON.stringify({ version: "0.0.1" }),
  );
  assert.equal(pnpmReady(paths), false);
});

test("packaging removes stale installers while retaining compiled dependencies", (t) => {
  const { dir, write } = fixture(t);
  const triple = "x86_64-unknown-linux-gnu";
  const stale = join(dir, triple, "release/bundle/deb/old.deb");
  const dependency = join(dir, triple, "release/deps/dependency.rlib");
  const debug = join(dir, "debug/deps/test");
  write(stale);
  write(dependency);
  write(debug);
  cleanBundles(dir, triple);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(dependency), true);
  assert.equal(existsSync(debug), true);
  assert.throws(() => cleanBundles(dir, "../../outside"), /valid target/);
});
