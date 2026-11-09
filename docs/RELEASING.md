# Desktop releases

The release workflow normally prepares a **draft** GitHub release for review and manual publication. An explicit manual replacement option can update an already published version. The repository is [huseyint/agent-usage](https://github.com/huseyint/agent-usage).

## Packages

| OS | CPU | Runner | Packages |
| --- | --- | --- | --- |
| macOS 13.3+ | Apple Silicon | Self-hosted macOS ARM64 | `.dmg`, `.app.tar.gz` |
| Windows 10/11 | x64 | Self-hosted Windows x64 | NSIS `-setup.exe` |
| Linux | x64 | Self-hosted Linux x64 | `.deb`, `.rpm`, `.AppImage` |

`.github/release-targets.json` is the shared matrix for maintainer verification and releases. Every app and engine builds and tests on its native CPU. Intel Mac, Windows ARM64 and Linux ARM64 builds are paused. This is a desktop release matrix; mobile, BSD, 32-bit systems, Snap and Flatpak are outside the current scope.

Every job uses a self-hosted runner. macOS jobs select `self-hosted`, `macOS` and `ARM64`. Windows x64 jobs select `self-hosted`, `windows` and `x64`. Linux x64 jobs and release helper jobs select `self-hosted`, `linux` and `x64`. Keep the runners online. Linux requires Docker accessible to the runner user; the matrix job builds `.github/docker/linux.Dockerfile` with the runner's UID/GID and pushes it to a registry bound to `127.0.0.1:5000` on that runner. Windows jobs reuse Git/Bash from PATH or the runner's persistent tool cache; a missing pinned version is downloaded and checksum-verified once. MSVC is reused when available, or installed from Microsoft's signed installer when the runner has administrator privileges.

Build caches are local to each runner. macOS and Windows use an `agent-usage/v1` directory under `RUNNER_TOOL_CACHE`; Linux mounts the named Docker volume `agent-usage-ci-cache-v1` at `/agent-usage-cache` and also retains Cargo downloads and Rust toolchains there. These paths are outside the cleaned checkout. Main-branch checks and releases share caches. Other refs have separate namespaces, but verification is restricted to owner-triggered runs on `main`. No Rust or pnpm cache archives are downloaded from or uploaded to GitHub.

The pinned pnpm installation and package store are retained between jobs. The ccusage binary is cached with its source and provenance, keyed by the builder, additive patches, compiler, target, deployment target and build flags. Binary and provenance checksums are verified before reuse. App Cargo output is retained, but old installer bundles are removed before packaging so a previous version cannot enter a new release. The first run fills the caches; later unchanged builds reuse them. These caches require local disk space and can be removed to force a cold build. None of this setup requires a new administrator installation on the runner hosts.

Linux targets Ubuntu 22.04 (glibc 2.35) as its build baseline. Linux x64 builds use an Ubuntu 22.04 container so the host distribution does not change that baseline. Packaging does not imply compatibility with every Linux distribution. Debian/RPM installations require their distribution's GTK/WebKitGTK dependencies; AppImage requires a suitable desktop and FUSE or extraction support. GNOME may need an AppIndicator extension for the tray. See [Tauri's AppImage guidance](https://v2.tauri.app/distribute/appimage/).

Windows bundles the Visual C++ runtime, installs for the current user and downloads Microsoft's WebView2 bootstrapper if the runtime is missing. This can require internet during installation. The app and bundled usage engine do not need Node, Bun, Rust or provider credentials at runtime.

## First repository setup

Create the GitHub repository and push the source, including `.github/`, both lockfiles, icons, synthetic test fixtures and the license files. The local `.cache/`, provider logs and generated binaries do not belong in source control. Each runner builds or reuses a verified cache of the engine from its pinned upstream revision.

Enable GitHub Actions. Verification runs only for the repository owner's pushes to `main` and manual runs on `main`. Pull requests never trigger self-hosted verification. Release workflows also require the repository owner as the triggering actor. The final `publish` job requests `contents: write`; all build jobs use read-only repository access. Creating a draft from an existing version tag uses the built-in token. Ordinary verification runs do not receive signing secrets.

After making the repository public, run `pnpm github:configure` with an authenticated GitHub CLI account that has repository administration access. It enables Dependabot alerts/security updates, private vulnerability reporting, secret scanning/push protection, read-only workflow tokens, approval for every external contributor's workflow, and protection of `main` against force pushes and deletion. Direct maintainer pushes remain allowed; no second reviewer is required. The command never changes repository visibility. Public-only settings are deferred while the repository is private on GitHub Free.

Run **Verify desktop targets** and review all three runner results for the exact release commit before tagging. Clean-machine installer checks are separate from CI and remain required; local packaging on one Mac is not evidence for the other targets.

Owner-triggered verification on `main` runs all frontend and native tests, formatting, Clippy and the frontend build, without generating installers or uploading artifacts. Linux also runs the vendored glib iterator tests in release mode; see [the backport provenance](../vendor/README.md). Releases additionally generate the license inventory, package and upload installers. To validate packaging without changing a release, manually dispatch `check.yml` with `package=true`:

```sh
gh workflow run check.yml --ref main -f package=true
```

## Prepare a version

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the app's package entry in `src-tauri/Cargo.lock`. Keep the frontend release history in `src/lib/releases.ts` current.
2. Add `docs/releases/VERSION.md` with the release notes. The workflow adds the download matrix and actual signing status.
3. Run `pnpm release:check`, `pnpm test` and `pnpm check` after building the host engine.
4. Commit the source and create/push its version tag:

   ```sh
   git tag -a v1.0.0 -m 'AI Coding Usage 1.0.0'
   git push origin v1.0.0
   ```

Pushing `v*` starts **Prepare GitHub release**. The workflow rejects tags that disagree with any version manifest or do not resolve to the checked-out commit. Alternatively, run that workflow manually with an existing version tag. A manual run uses the selected workflow revision to build the supplied tag, so use a revision containing the same release setup as the tag.

All three build jobs run the frontend/Rust tests, formatting, Clippy, dependency inventory, pinned engine build and installer packaging. After every job passes, the final job downloads the artifacts, validates version/source/target/checksums, generates `SHA256SUMS.txt` and creates the draft release. Installers have unique OS/CPU names, such as `AI-Coding-Usage_0.1.1_windows-x64-setup.exe`.

A failed platform prevents release uploads. Failed uploads can be retried: existing draft assets with the expected names are replaced, while published releases are preserved by default and unknown assets stop the upload. Known installers for the three retired targets are removed after the supported target assets have uploaded successfully. Normally a published version is followed by a new version/tag. Output directories must be empty so stale local packages cannot accidentally become release assets.

To explicitly replace a published version, back up its current assets and notes, then manually run `release.yml` on the source branch with the existing `tag` and `replace_published=true`. The source version must still match the tag. The workflow builds the selected workflow revision, verifies all supported targets and checksums, replaces the published downloads, and moves the tag to that exact source commit. It keeps the release published and rejects a tag changed during the build. For example:

```sh
gh workflow run release.yml --ref main -f tag=v1.0.0 -f replace_published=true
```

Moving an existing tag across workflow changes can be rejected with `Resource not accessible by integration` when using the built-in token. Tag updates use a dedicated write deploy key for this repository, stored in the `RELEASE_TAG_SSH_KEY` Actions secret. The key is written to a temporary file only during the tag push, GitHub's SSH host keys are obtained through its HTTPS API, and the temporary files are removed afterward. The push uses `--force-with-lease` to reject a concurrent tag change. The deploy key has repository write access; the publishing script uses it only for the selected release tag. Rotate it by replacing the deploy key and matching Actions secret together. See [GitHub's deploy-key documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

An optional `RELEASE_TOKEN` secret with **Contents: write** and **Workflows: write** is also supported. Without either credential, replacement fails during validation before any builds or asset changes, unless the tag already points to the correct source and no tag write is needed. A push triggered by replacing an already published tag skips duplicate builds.

If publication fails after all three native builds passed, retry publication using those artifacts instead of rebuilding:

```sh
gh workflow run release.yml --ref main -f tag=v1.0.0 -f replace_published=true -f artifact_run_id=COMPLETED_RUN_ID
```

Recovery accepts only completed runs of this repository's release workflow, with successful validation and all supported native build jobs and a complete, unexpired artifact set. It uses that run's source SHA, verifies every manifest against it and rechecks asset checksums. The selected workflow revision must have the same version and supported target matrix as the recovered release. An already correct tag is left untouched. Recovery requires artifacts from an existing run; deleted runs cannot be reused. The recovery has its own workflow run.

## Optional signing

Without secrets, macOS packages use ad-hoc signatures and are **not notarized**; Windows packages are unsigned. The generated release notes and manifests state the signing mode. These artifacts are useful for testing but will encounter OS trust checks. Configuring only part of a signing credential set fails the build instead of silently producing unsigned packages.

For an unnotarized macOS build, include the [first-launch instructions](../README.md#macos-first-launch) in the release notes. They cover both the System Settings exception and the app-specific Terminal command.

For Developer ID signing and Apple notarization, add these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity |
| `APPLE_ID` | Apple account email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple Developer team ID |

The workflow imports the certificate into a temporary keychain, signs through Tauri, waits for notarization/stapling, and removes the temporary keychain afterward. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

For Windows Authenticode, add `WINDOWS_CERTIFICATE` (base64 `.pfx` containing the signing private key) and `WINDOWS_CERTIFICATE_PASSWORD`. The workflow imports it into the runner's current-user certificate store, configures SHA-256 with a timestamp server, and removes the certificate afterward. Hardware/cloud-backed signing requires adapting this step to the certificate provider; do not export a non-exportable key. See [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

Never commit certificates, passwords or generated signing config. Temporary files live under ignored `.cache/release-signing/`; an `always()` cleanup step removes them.

## Review and publish

Download the draft assets, verify `SHA256SUMS.txt`, review dependency notices, and smoke-test installation and removal on each target. Check startup without development tools, both usage sources independently, refresh/export, tray/close/quit behavior, and a standard non-admin user. Review signing/notarization results on clean machines and complete the remaining checks in [VALIDATION.md](VALIDATION.md).

The release page contains the installers and one `SHA256SUMS.txt` covering those downloads. License notices and the dependency inventory remain bundled inside each app. Native CI artifacts retain the per-platform notices, SPDX inventories, engine provenance and target manifests for build verification. The engine checksum describes the build input before platform code signing; installer checksums describe the final downloadable files.

After review, publish the draft from GitHub Releases. The workflow does not push Git changes, create a repository or publish a draft on your behalf.

## Local packaging

```sh
pnpm install --frozen-lockfile
pnpm engine:build
pnpm licenses:generate
pnpm desktop:build
pnpm release:check
```

To prepare the host's installers for manual upload, use the actual Rust target and bundle location. For example, on Apple Silicon:

```sh
pnpm release:collect aarch64-apple-darwin --bundle-dir src-tauri/target/release/bundle
```

Output is `release-assets/aarch64-apple-darwin/`. Set `RELEASE_SIGNING=ad-hoc` if that is the signing mode used in your local build. The collector validates engine provenance and requires every format in the target's matrix. `pnpm release:assemble INPUT_DIR OUTPUT_DIR` accepts downloaded artifacts for all supported targets and creates the combined checksum list. Each target manifest must match the current version.

Each native CI artifact also includes its own `PLATFORM-SHA256SUMS.txt` for verifying that target's installers and notices before the complete release is assembled. The draft uploader selects only the installers and combined checksum file for the release page.
