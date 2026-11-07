import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildCachedEngine, hash } from "../scripts/build-engine-cached.mjs";

function fixture(t, { linkedLicense = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "engine-cache-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
    return path;
  };
  write("scripts/build-engine.mjs", `const revision = "${"a".repeat(40)}";`);
  write(
    "src-tauri/tauri.conf.json",
    JSON.stringify({ bundle: { macOS: { minimumSystemVersion: "13.3" } } }),
  );
  mkdirSync(join(dir, "docs"));
  const env = {
    ENGINE_TARGET: "x86_64-pc-windows-msvc",
    GITHUB_ENV: write("job-env", ""),
    CARGO_TARGET_DIR: join(dir, "app-target"),
  };
  let builds = 0;
  let compiler = "release: 1.90.0\nhost: x86_64-pc-windows-msvc\n";
  const options = {
    projectRoot: dir,
    cacheRoot: join(dir, "persistent"),
    env,
    run(exe, args, options) {
      if (exe === "rustc") return compiler;
      if (args[0] === join(dir, "scripts/build-engine.mjs")) {
        builds++;
        assert.equal(
          options.env.CARGO_TARGET_DIR,
          join(dir, ".cache/ccusage/rust/target"),
        );
        const binary = `src-tauri/binaries/ccusage-${env.ENGINE_TARGET}${env.ENGINE_TARGET.includes("windows") ? ".exe" : ""}`;
        const bytes = "synthetic-engine-" + builds;
        write(binary, bytes);
        write(
          binary + ".provenance.json",
          JSON.stringify({
            revision: "a".repeat(40),
            target: env.ENGINE_TARGET,
            sha256: hash(bytes),
          }),
        );
        write(".cache/ccusage/rust/Cargo.toml", "[workspace]\n");
        write(".cache/ccusage/LICENSE", "synthetic license");
        if (linkedLicense) {
          rmSync(join(dir, ".cache/ccusage/LICENSE"));
          write(".cache/ccusage/apps/ccusage/LICENSE", "synthetic license");
          symlinkSync(
            "apps/ccusage/LICENSE",
            join(dir, ".cache/ccusage/LICENSE"),
          );
        }
        write(".cache/ccusage/rust/target/large-build-output", "not copied");
      } else {
        assert.deepEqual(args, ["--version"]);
        assert.ok(existsSync(exe));
      }
      return "";
    },
  };
  return {
    dir,
    write,
    env,
    options,
    builds: () => builds,
    compiler: (value) => {
      compiler = value;
    },
  };
}

test("a warm engine cache survives checkout cleanup and retains source for license inventory", (t) => {
  const f = fixture(t);
  const first = buildCachedEngine(f.options);
  rmSync(join(f.dir, ".cache"), { recursive: true });
  rmSync(join(f.dir, "src-tauri/binaries"), { recursive: true });
  const second = buildCachedEngine(f.options);
  assert.equal(first.entry, second.entry);
  assert.equal(f.builds(), 1);
  assert.ok(
    readFileSync(f.env.GITHUB_ENV, "utf8").includes(
      "ENGINE_SOURCE=" + join(first.entry, "source"),
    ),
  );
  assert.ok(existsSync(join(first.entry, "source/rust/Cargo.toml")));
  assert.equal(existsSync(join(first.entry, "source/rust/target")), false);
});

test("engine cache invalidates for build scripts, additive patches, compiler and flags", (t) => {
  for (const change of [
    (f) =>
      f.write(
        "scripts/build-engine.mjs",
        `const revision = "${"a".repeat(40)}";\n// changed build flags`,
      ),
    (f) => f.write("scripts/patches/feature.patch", "changed source patch"),
    (f) => f.compiler("release: 1.91.0\nhost: x86_64-pc-windows-msvc\n"),
    (f) => {
      f.env.RUSTFLAGS = "-C target-cpu=native";
    },
    (f) => {
      f.env.ENGINE_TARGET = "aarch64-apple-darwin";
    },
  ]) {
    const f = fixture(t);
    const first = buildCachedEngine(f.options);
    change(f);
    assert.notEqual(buildCachedEngine(f.options).entry, first.entry);
    assert.equal(f.builds(), 2);
  }
});

test(
  "relative upstream license links survive removal of the original checkout",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t, { linkedLicense: true });
    const first = buildCachedEngine(f.options);
    rmSync(join(f.dir, ".cache"), { recursive: true });
    buildCachedEngine(f.options);
    assert.equal(f.builds(), 1);
    assert.equal(
      readFileSync(join(first.entry, "source/LICENSE"), "utf8"),
      "synthetic license",
    );
  },
);

test("a corrupt binary or interrupted cache write rebuilds the engine", (t) => {
  for (const change of [
    (entry) => writeFileSync(join(entry, "engine"), "corrupted"),
    (entry) => writeFileSync(join(entry, "engine.provenance.json"), "{}"),
    (entry) => rmSync(join(entry, "complete.json")),
    (entry) => rmSync(join(entry, "source/LICENSE")),
  ]) {
    const f = fixture(t);
    const first = buildCachedEngine(f.options);
    change(first.entry);
    buildCachedEngine(f.options);
    assert.equal(f.builds(), 2);
  }
});
