import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const cacheKey = (identity) => hash(JSON.stringify(identity));

export function validEntry(entry, identity) {
  try {
    const marker = JSON.parse(
      readFileSync(join(entry, "complete.json"), "utf8"),
    );
    const provenanceBytes = readFileSync(join(entry, "engine.provenance.json"));
    const provenance = JSON.parse(provenanceBytes);
    return (
      marker.key === cacheKey(identity) &&
      marker.provenanceSha256 === hash(provenanceBytes) &&
      provenance.revision === identity.revision &&
      provenance.target === identity.target &&
      provenance.sha256 === hash(readFileSync(join(entry, "engine"))) &&
      existsSync(join(entry, "source/rust/Cargo.toml")) &&
      existsSync(join(entry, "source/LICENSE"))
    );
  } catch {
    return false;
  }
}

export function buildCachedEngine({
  projectRoot = resolve(import.meta.dirname, ".."),
  cacheRoot = process.env.ENGINE_CACHE_ROOT,
  env = process.env,
  run = execFileSync,
} = {}) {
  if (!cacheRoot)
    throw Error("ENGINE_CACHE_ROOT must point to the persistent runner cache.");
  const script = join(projectRoot, "scripts/build-engine.mjs");
  const builder = readFileSync(script, "utf8");
  const revision = /const revision = "([a-f0-9]{40})"/.exec(builder)?.[1];
  if (!revision)
    throw Error("The engine builder must pin an exact source revision.");
  const compiler = run(env.RUSTC || "rustc", ["+stable", "-vV"], {
    encoding: "utf8",
  });
  const target = env.ENGINE_TARGET || compiler.match(/host: (.+)/)[1];
  if (!/^[a-z0-9_-]+$/.test(target)) throw Error("Invalid engine target.");
  const patchDir = join(projectRoot, "scripts/patches");
  const identity = {
    revision,
    target,
    compiler,
    builder: hash(builder),
    wrapper: hash(readFileSync(new URL(import.meta.url))),
    patches: existsSync(patchDir)
      ? readdirSync(patchDir)
          .sort()
          .map((name) => [name, hash(readFileSync(join(patchDir, name)))])
      : [],
    deploymentTarget: JSON.parse(
      readFileSync(join(projectRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ).bundle.macOS.minimumSystemVersion,
    environment: Object.fromEntries(
      Object.entries(env)
        .filter(([name]) =>
          /^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_PROFILE_|CARGO_TARGET_|CARGO_BUILD_|CC$|CXX$|AR$|CFLAGS|CXXFLAGS|LDFLAGS|SDKROOT$|CCUSAGE_PRICING_JSON_PATH$)/.test(
            name,
          ),
        )
        .sort(),
    ),
    pricing: env.CCUSAGE_PRICING_JSON_PATH
      ? hash(readFileSync(env.CCUSAGE_PRICING_JSON_PATH))
      : null,
  };
  const entry = join(cacheRoot, cacheKey(identity));
  const output = join(
    projectRoot,
    `src-tauri/binaries/ccusage-${target}${target.includes("windows") ? ".exe" : ""}`,
  );
  if (!validEntry(entry, identity)) {
    console.log(`Building pinned ccusage engine for ${target}`);
    // The existing builder collects its binary from this directory. Its source,
    // compiler flags and any additive patches remain the source of truth.
    run(process.execPath, [script], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...env,
        CARGO_TARGET_DIR: join(projectRoot, ".cache/ccusage/rust/target"),
      },
    });
    mkdirSync(entry, { recursive: true });
    rmSync(join(entry, "complete.json"), { force: true });
    copyFileSync(output, join(entry, "engine"));
    copyFileSync(
      `${output}.provenance.json`,
      join(entry, "engine.provenance.json"),
    );
    const source = join(projectRoot, ".cache/ccusage");
    const engineTarget = join(source, "rust/target");
    rmSync(join(entry, "source"), { recursive: true, force: true });
    cpSync(source, join(entry, "source"), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => path !== engineTarget,
    });
    const pending = join(entry, `complete.${process.pid}.tmp`);
    writeFileSync(
      pending,
      JSON.stringify({
        key: cacheKey(identity),
        provenanceSha256: hash(
          readFileSync(join(entry, "engine.provenance.json")),
        ),
      }) + "\n",
    );
    renameSync(pending, join(entry, "complete.json"));
    if (!validEntry(entry, identity))
      throw Error("Built engine failed cache verification.");
  } else {
    console.log(`Reusing verified ccusage engine for ${target}`);
  }
  mkdirSync(resolve(output, ".."), { recursive: true });
  copyFileSync(join(entry, "engine"), output);
  chmodSync(output, 0o755);
  copyFileSync(
    join(entry, "engine.provenance.json"),
    `${output}.provenance.json`,
  );
  writeFileSync(
    `${output}.sha256`,
    `${hash(readFileSync(output))}  ${output.split(/[\\/]/).at(-1)}\n`,
  );
  copyFileSync(
    join(entry, "source/LICENSE"),
    join(projectRoot, "docs/CCUSAGE_LICENSE"),
  );
  if (env.GITHUB_ENV)
    appendFileSync(env.GITHUB_ENV, `ENGINE_SOURCE=${join(entry, "source")}\n`);
  run(output, ["--version"], { cwd: projectRoot, stdio: "inherit", env });
  return { entry, identity };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  buildCachedEngine();
