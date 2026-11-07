import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const root = resolve(import.meta.dirname, "..");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
export const targets = json(join(root, ".github/release-targets.json"));
export const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export function checkVersion(projectRoot = root, tag) {
  const version = json(join(projectRoot, "package.json")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version))
    throw Error(`Unsupported release version: ${version}`);
  const tauri = json(join(projectRoot, "src-tauri/tauri.conf.json")).version;
  const cargo = readFileSync(
    join(projectRoot, "src-tauri/Cargo.toml"),
    "utf8",
  ).match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  const lock = readFileSync(
    join(projectRoot, "src-tauri/Cargo.lock"),
    "utf8",
  ).match(/^name = "agent-usage"\r?\nversion = "([^"]+)"/m)?.[1];
  if ([tauri, cargo, lock].some((value) => value !== version))
    throw Error(
      `Version mismatch: package=${version}, Tauri=${tauri}, Cargo=${cargo}, lock=${lock}`,
    );
  if (tag !== undefined && tag !== `v${version}`)
    throw Error(`Release tag must be v${version}; received ${tag}`);
  return version;
}

function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith(".app"))
      return filesIn(path);
    return [path];
  });
}

export function installerNames(version, target) {
  const base = `AI-Coding-Usage_${version}_${target.platform}`;
  return target.bundles
    .split(",")
    .map(
      (bundle) =>
        `${base}${{ app: ".app.tar.gz", dmg: ".dmg", nsis: "-setup.exe", deb: ".deb", rpm: ".rpm", appimage: ".AppImage" }[bundle]}`,
    );
}

export function releaseAssets(version) {
  return [
    ...targets.flatMap((target) => installerNames(version, target)),
    "SHA256SUMS.txt",
  ].sort();
}

export function retiredReleaseAssets(version) {
  const active = new Set(releaseAssets(version));
  return [
    { platform: "macos-x64", bundles: "app,dmg" },
    { platform: "windows-arm64", bundles: "nsis" },
    { platform: "linux-arm64", bundles: "deb,rpm,appimage" },
  ]
    .flatMap((target) => installerNames(version, target))
    .filter((name) => !active.has(name));
}

export function releaseNotes({ version, repository, builds, introduction }) {
  const base = `https://github.com/${repository}/releases/download/v${version}`;
  const downloads = (platform) => {
    const target = targets.find((entry) => entry.platform === platform);
    if (!builds.some((build) => build.target === target.target))
      throw Error(`Missing build: ${target.target}`);
    const labels = {
      app: "App archive",
      dmg: "DMG",
      nsis: "Installer",
      deb: "DEB",
      rpm: "RPM",
      appimage: "AppImage",
    };
    return installerNames(version, target)
      .map(
        (name, index) =>
          `[${labels[target.bundles.split(",")[index]]}](${base}/${name})`,
      )
      .join(" · ");
  };
  const warnings = [];
  if (
    builds.some(
      (build) =>
        build.platform.startsWith("macos") &&
        build.signing !== "developer-id-notarized",
    )
  )
    warnings.push("Mac builds are not notarized.");
  if (
    builds.some(
      (build) =>
        build.platform.startsWith("windows") &&
        build.signing !== "authenticode",
    )
  )
    warnings.push("Windows installers are unsigned.");
  return `${introduction.trim()}

| Platform | Downloads |
| --- | --- |
${targets.map((target) => `| ${target.label} | ${downloads(target.platform)} |`).join("\n")}

[SHA-256 checksums](${base}/SHA256SUMS.txt). ${warnings.join(" ")}
`;
}

function emptyOutput(dir) {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length)
    throw Error(`Output directory must be empty: ${dir}`);
}

export function collect({
  target: triple,
  projectRoot = root,
  bundleDir,
  outDir,
  signing = "unsigned",
  commit = process.env.GITHUB_SHA || null,
}) {
  const version = checkVersion(projectRoot);
  const target = targets.find((entry) => entry.target === triple);
  if (!target) throw Error(`Unsupported target: ${triple}`);
  bundleDir ||= join(projectRoot, "src-tauri/target", triple, "release/bundle");
  outDir ||= join(projectRoot, "release-assets", triple);
  const files = filesIn(bundleDir);
  const installers = target.bundles.split(",").map((bundle, index) => {
    const suffix = {
      app: ".app",
      dmg: ".dmg",
      nsis: ".exe",
      deb: ".deb",
      rpm: ".rpm",
      appimage: ".AppImage",
    }[bundle];
    const matches = files.filter((path) => path.endsWith(suffix));
    if (matches.length !== 1)
      throw Error(
        `Expected one ${bundle} for ${triple}, found ${matches.length}`,
      );
    return {
      source: matches[0],
      name: installerNames(version, target)[index],
      bundle,
    };
  });
  const engine = join(
    projectRoot,
    `src-tauri/binaries/ccusage-${triple}${triple.includes("windows") ? ".exe" : ""}`,
  );
  const provenance = json(`${engine}.provenance.json`);
  if (provenance.target !== triple || provenance.sha256 !== digest(engine))
    throw Error(`Engine provenance does not match ${triple}`);
  const metadata = [
    ["LICENSE", "LICENSE.txt"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    ["docs/CCUSAGE_LICENSE", "CCUSAGE_LICENSE.txt"],
    ["docs/SBOM.spdx.json", "SBOM.spdx.json"],
    ["docs/DEPENDENCY_LICENSES.txt", "DEPENDENCY_LICENSES.txt"],
    [
      `src-tauri/binaries/${basename(engine)}.provenance.json`,
      "engine.provenance.json",
    ],
    [`src-tauri/binaries/${basename(engine)}.sha256`, "engine.sha256"],
  ];
  for (const [source] of metadata) {
    if (!statSync(join(projectRoot, source)).isFile())
      throw Error(`Missing release input: ${source}`);
  }
  emptyOutput(outDir);
  for (const installer of installers) {
    const destination = join(outDir, installer.name);
    if (installer.bundle === "app") {
      const tar =
        process.platform === "win32"
          ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
          : "tar";
      execFileSync(
        tar,
        [
          "-czf",
          installer.name,
          "-C",
          resolve(installer.source, ".."),
          basename(installer.source),
        ],
        {
          cwd: outDir,
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      );
    } else copyFileSync(installer.source, destination);
  }
  for (const [source, name] of metadata)
    copyFileSync(
      join(projectRoot, source),
      join(outDir, `${target.platform}-${name}`),
    );
  const assets = readdirSync(outDir)
    .sort()
    .map((name) => ({
      name,
      sha256: digest(join(outDir, name)),
      bytes: statSync(join(outDir, name)).size,
    }));
  const checksums = `${target.platform}-SHA256SUMS.txt`;
  writeFileSync(
    join(outDir, checksums),
    assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n",
  );
  assets.push({
    name: checksums,
    sha256: digest(join(outDir, checksums)),
    bytes: statSync(join(outDir, checksums)).size,
  });
  const manifest = {
    version,
    target: triple,
    platform: target.platform,
    signing,
    commit,
    assets,
  };
  writeFileSync(
    join(outDir, `${target.platform}-manifest.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

export function assemble({
  inputDir,
  outDir,
  version = checkVersion(),
  expectedCommit,
} = {}) {
  inputDir ||= join(root, "release-assets");
  outDir ||= join(root, ".cache/github-release");
  const manifests = filesIn(inputDir).filter((path) =>
    path.endsWith("-manifest.json"),
  );
  if (manifests.length !== targets.length)
    throw Error(
      `Expected ${targets.length} target manifests, found ${manifests.length}`,
    );
  const seen = new Set();
  const inputs = [];
  const builds = [];
  for (const target of targets) {
    const path = manifests.find(
      (file) => basename(file) === `${target.platform}-manifest.json`,
    );
    if (!path) throw Error(`Missing target: ${target.target}`);
    const manifest = json(path);
    if (
      manifest.version !== version ||
      manifest.target !== target.target ||
      manifest.platform !== target.platform
    )
      throw Error(`Wrong version or target in ${path}`);
    if (expectedCommit && manifest.commit !== expectedCommit)
      throw Error(`Wrong source commit in ${path}`);
    const expectedNames = installerNames(version, target);
    for (const name of expectedNames) {
      if (!manifest.assets.some((asset) => asset.name === name))
        throw Error(`Missing installer: ${name}`);
    }
    for (const asset of manifest.assets) {
      if (
        asset.name !== basename(asset.name) ||
        /[\\\r\n]/.test(asset.name) ||
        seen.has(asset.name)
      )
        throw Error(`Invalid or duplicate asset: ${asset.name}`);
      const source = join(resolve(path, ".."), asset.name);
      if (
        digest(source) !== asset.sha256 ||
        statSync(source).size !== asset.bytes
      )
        throw Error(`Checksum mismatch: ${asset.name}`);
      inputs.push([source, asset.name]);
      seen.add(asset.name);
    }
    inputs.push([path, basename(path)]);
    seen.add(basename(path));
    builds.push({
      target: target.target,
      platform: target.platform,
      signing: manifest.signing,
      commit: manifest.commit,
    });
  }
  emptyOutput(outDir);
  for (const [source, name] of inputs) copyFileSync(source, join(outDir, name));
  writeFileSync(
    join(outDir, "release-manifest.json"),
    JSON.stringify({ version, builds }, null, 2) + "\n",
  );
  const sums = releaseAssets(version)
    .filter((name) => name !== "SHA256SUMS.txt")
    .map((name) => `${digest(join(outDir, name))}  ${name}`)
    .join("\n");
  writeFileSync(join(outDir, "SHA256SUMS.txt"), sums + "\n");
  return builds;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "matrix") {
    const matrix = JSON.stringify({ include: targets });
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
    else console.log(matrix);
  } else if (command === "check-version")
    console.log(checkVersion(root, args[0]));
  else if (command === "collect") {
    const options = {
      target: args[0],
      signing: process.env.RELEASE_SIGNING || "unsigned",
      commit: process.env.RELEASE_COMMIT || process.env.GITHUB_SHA || null,
    };
    for (let index = 1; index < args.length; index += 2) {
      const key = { "--bundle-dir": "bundleDir", "--out-dir": "outDir" }[
        args[index]
      ];
      if (!key || !args[index + 1])
        throw Error(`Invalid option: ${args[index]}`);
      options[key] = resolve(args[index + 1]);
    }
    console.log(JSON.stringify(collect(options), null, 2));
  } else if (command === "assemble") {
    assemble({
      inputDir: args[0] && resolve(args[0]),
      outDir: args[1] && resolve(args[1]),
      expectedCommit: process.env.RELEASE_COMMIT,
    });
    console.log(
      "Verified all targets and wrote release assets + SHA256SUMS.txt.",
    );
  } else
    throw Error(
      "Use: release.mjs matrix | check-version [vVERSION] | collect TARGET [--bundle-dir DIR] [--out-dir DIR] | assemble [INPUT_DIR OUTPUT_DIR]",
    );
}
