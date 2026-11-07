import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function cachePaths({
  toolCache,
  volumeRoot,
  ref = "",
  event = "",
  target,
  packageManager,
}) {
  if (!/^[a-z0-9_-]+$/.test(target || "")) throw Error("Invalid cache target.");
  const version = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(
    packageManager || "",
  )?.[1];
  if (!version) throw Error("An exact pnpm version is required.");
  const scope =
    event === "pull_request"
      ? `pr-${createHash("sha256").update(ref).digest("hex").slice(0, 12)}`
      : ref === "refs/heads/main" || ref.startsWith("refs/tags/")
        ? "release"
        : `branch-${createHash("sha256").update(ref).digest("hex").slice(0, 12)}`;
  if (!volumeRoot && !toolCache)
    throw Error("A persistent runner cache directory is required.");
  const root = join(volumeRoot || join(toolCache, "agent-usage"), "v1", scope);
  const pnpm = join(root, "pnpm", version);
  return {
    root,
    app: join(root, "app", target),
    engine: join(root, "engine"),
    cargo: join(root, "cargo"),
    rustup: join(root, "rustup"),
    store: join(root, "pnpm-store"),
    pnpm,
    pnpmBin: join(pnpm, "node_modules", ".bin"),
    version,
  };
}

export function pnpmReady(paths, platform = process.platform) {
  try {
    return (
      readFileSync(join(paths.pnpm, ".complete"), "utf8").trim() ===
        paths.version &&
      JSON.parse(
        readFileSync(
          join(paths.pnpm, "node_modules/pnpm/package.json"),
          "utf8",
        ),
      ).version === paths.version &&
      existsSync(
        join(paths.pnpmBin, platform === "win32" ? "pnpm.cmd" : "pnpm"),
      )
    );
  } catch {
    return false;
  }
}

export function cleanBundles(targetDir, target) {
  if (!targetDir || !/^[a-z0-9_-]+$/.test(target || ""))
    throw Error("A cache directory and valid target are required.");
  rmSync(join(targetDir, target, "release/bundle"), {
    recursive: true,
    force: true,
  });
}

function currentPaths() {
  return cachePaths({
    toolCache: process.env.RUNNER_TOOL_CACHE,
    volumeRoot: process.env.CI_CACHE_VOLUME,
    ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME,
    target: process.env.ENGINE_TARGET,
    packageManager: JSON.parse(readFileSync("package.json", "utf8"))
      .packageManager,
  });
}

function output(file, name, value) {
  if (/[\r\n]/.test(value)) throw Error("Invalid cache output.");
  appendFileSync(file, `${name}=${value}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const paths = currentPaths();
  if (process.argv[2] === "clean-bundles")
    cleanBundles(paths.app, process.env.ENGINE_TARGET);
  else if (process.argv[2] === "pnpm-ready") {
    const installed = JSON.parse(
      readFileSync(join(paths.pnpm, "node_modules/pnpm/package.json"), "utf8"),
    );
    if (installed.version !== paths.version)
      throw Error("Installed pnpm version does not match package.json.");
    writeFileSync(join(paths.pnpm, ".complete"), paths.version + "\n");
  } else {
    for (const path of [paths.app, paths.engine, paths.store])
      mkdirSync(path, { recursive: true });
    const env = {
      CARGO_TARGET_DIR: paths.app,
      ENGINE_CACHE_ROOT: paths.engine,
      CI_PNPM_STORE: paths.store,
      npm_config_store_dir: paths.store,
      PNPM_HOME: paths.pnpmBin,
    };
    if (process.env.CI_CACHE_VOLUME) {
      mkdirSync(paths.cargo, { recursive: true });
      mkdirSync(paths.rustup, { recursive: true });
      env.CARGO_HOME = paths.cargo;
      env.RUSTUP_HOME = paths.rustup;
      appendFileSync(process.env.GITHUB_PATH, join(paths.cargo, "bin") + "\n");
    }
    for (const [name, value] of Object.entries(env))
      output(process.env.GITHUB_ENV, name, value);
    appendFileSync(process.env.GITHUB_PATH, paths.pnpmBin + "\n");
    output(process.env.GITHUB_OUTPUT, "pnpm-dest", paths.pnpm);
    output(process.env.GITHUB_OUTPUT, "pnpm-version", paths.version);
    output(process.env.GITHUB_OUTPUT, "pnpm-ready", String(pnpmReady(paths)));
    console.log(`Using persistent build cache: ${paths.root}`);
  }
}
