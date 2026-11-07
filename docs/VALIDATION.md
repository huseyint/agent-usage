# Testing and release verification

## Automated checks

Install the toolchain described in the README, then build the pinned engine before running native tests:

```sh
pnpm install --frozen-lockfile
pnpm engine:build
pnpm test
pnpm check
```

`pnpm test` runs JavaScript tests and Rust unit/integration tests. `pnpm check` builds the production frontend, checks Rust formatting, and runs Clippy with warnings denied. Tests use synthetic provider fixtures. Opt-in diagnostics that require local user data are ignored by default.

Coverage includes provider/schema compatibility, event-day and session-lifetime attribution, missing pricing, bounded metadata parsing, source isolation, CSV escaping, SQLite persistence, session activity, project icons, filtering/pagination, timezone/DST behavior and tray placement. Release tests check version consistency, all target installers, engine provenance, source identity and payload checksums.

The GitHub verification workflow runs only for the repository owner on `main`, never for pull requests. It builds the same three native targets as the release workflow, entirely on self-hosted runners: macOS Apple Silicon, Windows x64 and Linux x64. Intel Mac, Windows ARM64 and Linux ARM64 builds are paused. Passing on one target does not establish support for another target.

Linux CI additionally runs `cargo test --manifest-path vendor/glib/Cargo.toml --release --lib variant_iter::tests` to verify the upstream security backport under optimization. See [vendor/README.md](../vendor/README.md) for the original source checksum and exact patch.

## Installer smoke checks

Before publishing a release, test each installer on a clean target machine with no Node, Bun or Rust development toolchain:

- Install, launch, upgrade and uninstall with a standard user account.
- Confirm that the bundled engine is found and reports the supported version.
- Import synthetic Claude Code and Codex sources independently and together.
- Verify refresh, cancellation, source-error recovery and retention of the prior snapshot after a failed scan.
- Check CSV/JSON export, settings persistence, local annotations and cache clearing.
- Check tray availability, open/close/hide/quit behavior, keyboard navigation, display scaling and multiple monitors.
- Check light/dark appearance, the minimum window size, and accessibility with the platform's screen reader.
- Review signing/notarization and verify the release checksums and dependency notices.

Linux tray availability depends on the desktop environment; exercise a supported fallback when no tray is available. Test representative large and compressed source files when changing metadata or engine behavior.

See [RELEASING.md](RELEASING.md) for packaging, signing, checksums and the draft-release process. Report reproducible failures with synthetic fixtures and safe diagnostics; never attach private logs or titles.
