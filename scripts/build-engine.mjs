import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const revision = "2c92293e0a1d6a395c6a10a23267855e3205a1a6";
const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, ".cache/ccusage");
const deploymentTarget = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
).bundle.macOS.minimumSystemVersion;
const run = (exe, args, cwd = dir) =>
  execFileSync(exe, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(process.platform === "darwin"
        ? { MACOSX_DEPLOYMENT_TARGET: deploymentTarget }
        : {}),
    },
  });
mkdirSync(dir, { recursive: true });
if (!existsSync(resolve(dir, ".git"))) run("git", ["init"]);
run("git", [
  "fetch",
  "--depth",
  "1",
  "https://github.com/ccusage/ccusage.git",
  revision,
]);
run("git", ["checkout", "--detach", "FETCH_HEAD"]);
const patch = resolve(root, "scripts/patches/ccusage-session-usage.patch");
// Reset only the files owned by our additive report patch before rebuilding.
run("git", [
  "restore",
  "--source=HEAD",
  "--",
  "rust/crates/ccusage-adapter-all/src/loader.rs",
  "rust/crates/ccusage-adapter-all/src/report.rs",
]);
run("git", ["apply", "--check", patch]);
run("git", ["apply", patch]);
const cargo = process.env.CARGO || "cargo";
const target =
  process.env.ENGINE_TARGET ||
  execFileSync(process.env.RUSTC || "rustc", ["-vV"], {
    encoding: "utf8",
  }).match(/host: (.+)/)[1];
run(cargo, [
  "+stable",
  "build",
  "--locked",
  "--release",
  "--manifest-path",
  "rust/Cargo.toml",
  "-p",
  "ccusage",
  "--features",
  "fetch-litellm-pricing",
  "--target",
  target,
]);
const ext = target.includes("windows") ? ".exe" : "";
const output = resolve(root, `src-tauri/binaries/ccusage-${target}${ext}`);
mkdirSync(resolve(root, "src-tauri/binaries"), { recursive: true });
copyFileSync(
  resolve(dir, `rust/target/${target}/release/ccusage${ext}`),
  output,
);
chmodSync(output, 0o755);
const sha256 = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, `${sha256}  ccusage-${target}${ext}\n`);
writeFileSync(
  `${output}.provenance.json`,
  JSON.stringify(
    {
      version: "20.0.48",
      revision,
      patchSha256: createHash("sha256")
        .update(readFileSync(patch))
        .digest("hex"),
      target,
      sha256,
      pricingInput: JSON.parse(readFileSync(resolve(dir, "flake.lock"))).nodes
        .litellm.locked,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
copyFileSync(resolve(dir, "LICENSE"), resolve(root, "docs/CCUSAGE_LICENSE"));
run(output, ["--version"], root);
