import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const run = (exe, args, cwd = root) =>
  execFileSync(exe, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const cargo = process.env.CARGO || "cargo";
const npm = JSON.parse(
  process.platform === "win32"
    ? run(process.env.ComSpec || "cmd.exe", [
        "/d",
        "/s",
        "/c",
        "pnpm licenses list --json",
      ])
    : run("pnpm", ["licenses", "list", "--json"]),
);
const native = JSON.parse(
  run(cargo, [
    "metadata",
    "--locked",
    "--format-version",
    "1",
    "--manifest-path",
    "src-tauri/Cargo.toml",
  ]),
);
const engineSource =
  process.env.ENGINE_SOURCE || resolve(root, ".cache/ccusage");
if (!existsSync(join(engineSource, "rust/Cargo.toml")))
  throw Error(
    "Build the pinned engine first, or set ENGINE_SOURCE to its exact checkout.",
  );
const engine = JSON.parse(
  run(
    cargo,
    [
      "+stable",
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      "rust/Cargo.toml",
    ],
    engineSource,
  ),
);
const inventory = new Map();
const texts = [];
function collect(name, version, license, dir, origin) {
  const key = `${origin}:${name}@${version}`;
  if (inventory.has(key)) return;
  inventory.set(key, {
    SPDXID: `SPDXRef-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
    name,
    versionInfo: version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: license || "NOASSERTION",
    copyrightText: "NOASSERTION",
    comment: `Dependency inventory: ${origin}`,
  });
  if (!dir || !existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) =>
    /^(licen[sc]e|copying|notice)([-_.].*)?$/i.test(f),
  )) {
    try {
      const content = readFileSync(join(dir, file), "utf8")
        .replace(/\r\n?/g, "\n")
        .replace(/[\t ]+$/gm, "");
      if (content.length < 250000)
        texts.push(
          `\n${"=".repeat(72)}\n${key} — ${file}\n${"=".repeat(72)}\n${content}`,
        );
    } catch {}
  }
}
for (const rows of Object.values(npm))
  for (const p of rows)
    for (const version of p.versions)
      collect(p.name, version, p.license, p.paths?.[0], "npm");
for (const [origin, meta] of [
  ["app-rust", native],
  ["ccusage-rust", engine],
])
  for (const p of meta.packages)
    collect(p.name, p.version, p.license, dirname(p.manifest_path), origin);
const packages = [...inventory.values()].sort(
  (a, b) =>
    a.name.localeCompare(b.name) || a.versionInfo.localeCompare(b.versionInfo),
);
const hash = createHash("sha256")
  .update(JSON.stringify(packages))
  .digest("hex");
writeFileSync(
  join(root, "docs/SBOM.spdx.json"),
  JSON.stringify(
    {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "AI Coding Usage dependency inventory",
      documentNamespace: `https://spdx.org/spdxdocs/agent-usage-${hash}`,
      creationInfo: {
        created: new Date().toISOString(),
        creators: ["Tool: agent-usage-sbom-0.1"],
      },
      packages,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(root, "docs/DEPENDENCY_LICENSES.txt"),
  `Dependency license notices. Source roots and private paths are omitted.\nLicenses are declared by upstream packages; review the SPDX inventory for metadata.\n${texts.join("\n")}\n`,
);
console.log(
  `Wrote SPDX inventory for ${packages.length} packages and ${texts.length} license texts.`,
);
