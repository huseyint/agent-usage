import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  assemble,
  checkVersion,
  collect,
  digest,
  installerNames,
  releaseAssets,
  releaseNotes,
  root,
  targets,
} from "../scripts/release.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-usage-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path, content) => {
    const dest = join(dir, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    return dest;
  };
  for (const name of [
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ])
    write(name, readFileSync(join(root, name)));
  for (const name of [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "docs/CCUSAGE_LICENSE",
    "docs/SBOM.spdx.json",
    "docs/DEPENDENCY_LICENSES.txt",
  ])
    write(name, "Synthetic license inventory\n");
  const version = checkVersion(dir);
  for (const target of targets) {
    const engine = `src-tauri/binaries/ccusage-${target.target}${target.target.includes("windows") ? ".exe" : ""}`;
    const path = write(engine, "synthetic native engine");
    write(
      `${engine}.provenance.json`,
      JSON.stringify({ target: target.target, sha256: digest(path) }),
    );
    write(`${engine}.sha256`, `${digest(path)}  engine\n`);
    for (const bundle of target.bundles.split(",")) {
      const base = `src-tauri/target/${target.target}/release/bundle/${bundle}/AI Coding Usage`;
      const suffix = {
        app: ".app/Contents/MacOS/agent-usage",
        dmg: ".dmg",
        nsis: ".exe",
        deb: ".deb",
        rpm: ".rpm",
        appimage: ".AppImage",
      }[bundle];
      write(`${base}${suffix}`, "synthetic package payload");
    }
  }
  return { dir, write, version, output: join(dir, "assembled") };
}
function collectAll(f) {
  for (const target of targets)
    collect({
      target: target.target,
      projectRoot: f.dir,
      commit: "test-commit",
    });
}
function assembleFixture(f) {
  return assemble({
    inputDir: join(f.dir, "release-assets"),
    outDir: f.output,
    version: f.version,
    expectedCommit: "test-commit",
  });
}
function changeManifest(f, change) {
  const path = join(
    f.dir,
    "release-assets",
    targets[0].target,
    `${targets[0].platform}-manifest.json`,
  );
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

test("release versions match all manifests and the exact version tag", (t) => {
  const f = fixture(t);
  assert.equal(checkVersion(f.dir, `v${f.version}`), f.version);
  assert.throws(() => checkVersion(f.dir, "v99.0.0"), /tag must be/);
  const config = JSON.parse(
    readFileSync(join(f.dir, "src-tauri/tauri.conf.json"), "utf8"),
  );
  config.version = "99.0.0";
  f.write("src-tauri/tauri.conf.json", JSON.stringify(config));
  assert.throws(() => checkVersion(f.dir), /Version mismatch/);
});

test("all three self-hosted targets assemble unique installers, notices and verifiable checksums", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    targets.map((target) => target.platform),
    ["macos-arm64", "windows-x64", "linux-x64"],
  );
  assert.ok(
    targets.every(
      (target) => Array.isArray(target.os) && target.os.includes("self-hosted"),
    ),
  );
  assert.equal(new Set(targets.map((target) => target.target)).size, 3);
  collectAll(f);
  const builds = assembleFixture(f);
  assert.equal(builds.length, 3);
  for (const target of targets)
    for (const name of installerNames(f.version, target))
      assert.ok(readdirSync(f.output).includes(name));
  const rows = readFileSync(join(f.output, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(
    rows.map((row) => row.split("  ")[1]),
    releaseAssets(f.version).filter((name) => name !== "SHA256SUMS.txt"),
  );
  assert.equal(rows.length, 6);
  assert.equal(releaseAssets(f.version).length, 7);
  for (const row of rows) {
    const [hash, name] = row.split("  ");
    assert.equal(digest(join(f.output, name)), hash);
  }
});

test("release notes link only the supported platform installers", () => {
  const version = checkVersion();
  const builds = targets.map(({ target, platform }) => ({
    target,
    platform,
    signing: "unsigned",
  }));
  const notes = releaseNotes({
    version,
    repository: "huseyint/agent-usage",
    builds,
    introduction: "Release introduction.",
  });
  for (const target of targets) {
    assert.ok(notes.includes(target.label));
    for (const name of installerNames(version, target))
      assert.ok(notes.includes(name));
  }
  assert.doesNotMatch(notes, /macos-x64|windows-arm64|linux-arm64/);
  assert.throws(
    () =>
      releaseNotes({
        version,
        repository: "huseyint/agent-usage",
        builds: builds.slice(1),
        introduction: "Release introduction.",
      }),
    /Missing build/,
  );
});

test("collection rejects missing installers, stale output and wrong engine provenance", (t) => {
  const f = fixture(t);
  const target = targets.find((entry) => entry.platform === "windows-x64");
  const options = { target: target.target, projectRoot: f.dir };
  const installer = join(
    f.dir,
    `src-tauri/target/${target.target}/release/bundle/nsis/AI Coding Usage.exe`,
  );
  rmSync(installer);
  assert.throws(() => collect(options), /Expected one nsis/);
  f.write(
    `src-tauri/target/${target.target}/release/bundle/nsis/AI Coding Usage.exe`,
    "installer",
  );
  const provenance = `src-tauri/binaries/ccusage-${target.target}.exe.provenance.json`;
  const original = readFileSync(join(f.dir, provenance));
  f.write(provenance, JSON.stringify({ target: "wrong", sha256: "invalid" }));
  assert.throws(() => collect(options), /Engine provenance/);
  f.write(provenance, original);
  collect(options);
  assert.throws(() => collect(options), /must be empty/);
});

test("assembly rejects partial platforms, wrong source versions and missing installers", (t) => {
  const f = fixture(t);
  collect({
    target: targets[0].target,
    projectRoot: f.dir,
    commit: "test-commit",
  });
  assert.throws(() => assembleFixture(f), /Expected 3/);
  for (const target of targets.slice(1))
    collect({
      target: target.target,
      projectRoot: f.dir,
      commit: "test-commit",
    });
  changeManifest(f, (manifest) => {
    manifest.commit = "different";
  });
  assert.throws(() => assembleFixture(f), /Wrong source commit/);
  changeManifest(f, (manifest) => {
    manifest.commit = "test-commit";
    manifest.version = "99.0.0";
  });
  assert.throws(() => assembleFixture(f), /Wrong version or target/);
  changeManifest(f, (manifest) => {
    manifest.version = f.version;
    manifest.assets = manifest.assets.filter(
      (asset) => !asset.name.endsWith(".dmg"),
    );
  });
  assert.throws(() => assembleFixture(f), /Missing installer/);
});

test("assembly rejects altered payloads, duplicate names and path traversal", (t) => {
  const f = fixture(t);
  collectAll(f);
  const target = targets[0];
  const name = installerNames(f.version, target).find((item) =>
    item.endsWith(".dmg"),
  );
  const path = join(f.dir, "release-assets", target.target, name);
  const original = readFileSync(path);
  writeFileSync(path, "modified installer");
  assert.throws(() => assembleFixture(f), /Checksum mismatch/);
  writeFileSync(path, original);
  changeManifest(f, (manifest) => {
    manifest.assets.push(manifest.assets[0]);
  });
  assert.throws(() => assembleFixture(f), /duplicate asset/);
  changeManifest(f, (manifest) => {
    manifest.assets.pop();
    manifest.assets.push({ name: "../private-file" });
  });
  assert.throws(() => assembleFixture(f), /Invalid or duplicate asset/);
});
