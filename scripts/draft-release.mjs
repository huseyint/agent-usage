import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { moveReleaseTag } from "./release-tag.mjs";
import {
  checkVersion,
  releaseAssets,
  releaseNotes,
  retiredReleaseAssets,
  root,
} from "./release.mjs";

export function prepareRelease({
  tag = process.env.RELEASE_TAG,
  projectRoot = root,
  repository = process.env.GH_REPO || process.env.GITHUB_REPOSITORY,
  replacePublished = process.env.RELEASE_REPLACE_PUBLISHED === "true",
  commit = process.env.RELEASE_COMMIT,
  previousTag = process.env.RELEASE_PREVIOUS_TAG,
  runGh,
  updateTag = moveReleaseTag,
} = {}) {
  if (!tag) throw Error("RELEASE_TAG is required.");
  if (!repository) throw Error("GH_REPO or GITHUB_REPOSITORY is required.");
  const version = checkVersion(projectRoot, tag);
  const dir = join(projectRoot, ".cache/github-release");
  const manifest = JSON.parse(
    readFileSync(join(dir, "release-manifest.json"), "utf8"),
  );
  if (manifest.version !== version)
    throw Error("Assembled release version does not match the tag.");
  const gh =
    runGh ||
    ((args) =>
      execFileSync("gh", args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
  const releases = JSON.parse(
    gh(["release", "list", "--limit", "100", "--json", "tagName,isDraft"]),
  );
  const existing = releases.find((release) => release.tagName === tag);
  const published = existing && !existing.isDraft;
  if (published && !replacePublished)
    throw Error(
      `Refusing to modify published release ${tag}. Use a new version or explicitly enable replacement.`,
    );
  if (replacePublished) {
    if (!published)
      throw Error("Replacement requires an existing published release.");
    if (!/^[a-f0-9]{40}$/.test(commit || "") || !previousTag)
      throw Error(
        "Replacement requires RELEASE_COMMIT and RELEASE_PREVIOUS_TAG.",
      );
    if (manifest.builds.some((build) => build.commit !== commit))
      throw Error(
        "Replacement assets do not match the requested source commit.",
      );
    const currentTag = JSON.parse(
      gh([
        "api",
        `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
      ]),
    );
    if (currentTag.object.sha !== previousTag)
      throw Error(
        "Release tag changed while building. Refusing to replace it.",
      );
  }
  const assets = releaseAssets(version);
  let retiredAssets = [];
  if (existing) {
    const details = JSON.parse(
      gh(["release", "view", tag, "--json", "assets"]),
    );
    const retiredNames = new Set(retiredReleaseAssets(version));
    retiredAssets = details.assets.filter((asset) =>
      retiredNames.has(asset.name),
    );
    const unexpected = details.assets.filter(
      (asset) => !assets.includes(asset.name) && !retiredNames.has(asset.name),
    );
    if (unexpected.length)
      throw Error(
        "Release has unexpected assets. Review those before uploading.",
      );
  }
  const body = releaseNotes({
    version,
    repository,
    builds: manifest.builds,
    introduction: readFileSync(
      join(projectRoot, `docs/releases/${version}.md`),
      "utf8",
    ),
  });
  const bodyPath = join(projectRoot, ".cache/release-notes.md");
  writeFileSync(bodyPath, body);
  if (!existing) {
    const args = [
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      "--title",
      `AI Coding Usage ${version}`,
      "--notes-file",
      bodyPath,
    ];
    if (version.includes("-")) args.push("--prerelease");
    gh(args);
  }
  for (let index = 0; index < assets.length; index += 10)
    gh([
      "release",
      "upload",
      tag,
      ...assets.slice(index, index + 10).map((name) => join(dir, name)),
      "--clobber",
    ]);
  for (const asset of retiredAssets)
    gh(["release", "delete-asset", tag, asset.name, "--yes"]);
  if (replacePublished) updateTag({ repository, tag, commit, previousTag, gh });
  gh([
    "release",
    "edit",
    tag,
    ...(published ? [] : ["--draft"]),
    "--notes-file",
    bodyPath,
  ]);
  console.log(
    published
      ? `Replaced published ${tag} with ${assets.length} assets from ${commit}.`
      : `Prepared draft ${tag} with ${assets.length} assets. Review and publish it from GitHub Releases.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  prepareRelease();
