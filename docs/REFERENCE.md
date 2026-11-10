# Reference

A local-first desktop dashboard for Claude Code and OpenAI Codex usage, built with Tauri, React and Rust. Browse named sessions, projects and models, view daily/weekly/monthly usage in Overview, and keep today's usage in the menu bar or system tray.

**All costs are estimated USD API-equivalent token value. They are not Claude/ChatGPT subscription bills, consumed credits, or charges due.** Unknown pricing is labeled as a partial estimate.

No account, local server, telemetry, uploads, provider credentials or runtime Node/Bun dependency. Source logs are read-only. Your annotations and rebuildable snapshot live in a local SQLite database.

## Develop

Prerequisites: Node 26.13+ LTS (see `.node-version` for the exact development and CI version), pnpm, stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools. If Cargo is not on PATH, run `source "$HOME/.cargo/env"`.

```sh
pnpm install --frozen-lockfile
pnpm engine:build              # Exact pinned upstream revision; build-time downloads
pnpm desktop                   # Native Tauri app + Vite
```

Generated engine binaries are ignored by Git; a fresh checkout must run `pnpm engine:build` before Cargo tests or Tauri builds. The build script creates the correct target-suffixed executable, SHA-256 checksum and provenance JSON. Set `ENGINE_TARGET` to a supported Rust target for cross-compilation when its linker/toolchain is available. CI builds each target natively.

```sh
pnpm dev                      # Explicit synthetic browser preview at 127.0.0.1:1420
# Open /?window=tray to preview the popover with synthetic data.
pnpm build                    # TypeScript + production frontend
pnpm test                     # Frontend boundary tests + Rust fixture/integration tests
pnpm check                    # Production frontend + cargo fmt + Clippy
pnpm desktop:build            # Host installers, with the bundled native engine
pnpm licenses:generate                     # SPDX dependency inventory and third-party license texts
```

Browser preview always says **Synthetic preview**. It cannot read local files. Native mode never substitutes example data for failed scans. Stop a standalone Vite server before `pnpm desktop` so port 1420 is free.

## Use

1. Complete the short onboarding. It detects `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `~/.claude`, `~/.config/claude` and `~/.codex`. Both providers are optional; custom roots can be added in Settings → Sources.
2. Refresh to build a snapshot. A missing/failed/incompatible source is shown explicitly; the prior verified snapshot remains visible with a stale label.
3. Browse Sessions. The default groups by the local calendar day of **last activity**, newest first. The **Cost** column and group totals count usage recorded within the selected dates. Session lifetime cost is shown only in session details. Overview's daily/weekly/monthly chart uses ccusage's actual event-day records.
4. Open a session for token/model breakdowns, local title edits, favorites, tags, safe copy actions and known project/source locations. Local annotations never change Claude or Codex files.
5. Export daily usage from Overview, or sessions, projects and models from their respective pages, as CSV or JSON. Exports include filters, timestamps, timezone, attribution, engine version and source coverage; CSV escapes spreadsheet formula prefixes. Source paths and raw prompts are omitted from exported session rows.

Provider/date filters apply across pages. Session search, project/model filters, favorites, tags, source, provenance, cost/token bounds and sorting remain session-specific. Sorting by cost/token categories explicitly switches to an ungrouped result. Sessions load automatically as you scroll; group subtotals cover the whole matching group, including sessions not yet loaded.

The app remembers the last page, provider, date range, custom dates, session search and filters, grouping, sorting, visible columns, chart options, and Settings section between launches. Relative ranges such as Last 7 days keep rolling with the current date. The configured default range applies until a range is selected; preference refreshes preserve the active selection. Tray provider filters are remembered independently.

The app uses compact spacing. Settings supports system/light/dark appearance, timezone, week start, default range, custom roots, bundled/external engine, cost/speed modes, refresh intervals, tray behavior and privacy/cache controls. **Save changes**, then refresh after changing sources, engine, mode or timezone. The bundled engine includes an additive patch that retains per-session daily usage from ccusage’s own deduplicated, priced records. Its hash is recorded in engine provenance. Refresh existing snapshots to populate period costs; older/external snapshots show an unavailable value when a period cannot be derived safely. External engines are tested against ccusage **20.0.48**; the app never silently changes engines.

Click the menu bar or system tray icon to open a compact popover with recent sessions, provider filters, today’s estimate and provider split. The eight most recent sessions are sorted by last activity across all dates; selecting one opens its details in the dashboard. The menu bar, tray totals and recent sessions show only today’s recorded cost, including zero for sessions with no usage today. Overview, Sessions, Projects and Models show only the selected period’s cost. Session details also show the session’s lifetime cost. Today’s totals and date roll over at midnight in the display timezone, including when scanning is disabled or a scan is still running. Recent sessions stay independent of that day: the list fills from earlier dates, including Friday after a quiet weekend. Refresh, Settings, View all, Open dashboard and Quit are available in the panel. Escape or clicking elsewhere dismisses it. On macOS, native mouse monitors catch left, right and middle clicks outside the panel, including non-activating desktop/menu-bar clicks and other displays; the click continues to its original destination. The right-click menu remains available, including a Recent Sessions action for trays that do not deliver left-click events. View → Recent Sessions also opens the panel. New sessions get a small **New** label in the popover, Sessions list and Overview’s Top sessions. The tray uses a transparent monochrome activity glyph (a system-tinted template on macOS, white on Windows/Linux) with an attention dot while unchecked sessions remain. Checking sessions in either focused window acknowledges the sessions shown; their labels remain for that visit and clear on the next visit. Hidden windows and background refreshes do not acknowledge sessions. The checked state is shared through SQLite and survives restarts. Existing history starts checked when upgrading. Close hides to tray by default when it is available and enabled. Otherwise close exits. Use the app menu or tray Quit to terminate. macOS can optionally show a cost title; Windows/Linux also retain the native menu and tooltip. GNOME may require an AppIndicator extension; absence of a tray does not prevent using the app.

Project names share icons across Overview, Projects, Sessions, project filters and the tray. Discovery uses JetBrains custom icons, Xcode asset catalogs, Android manifest launcher resources, Windows app manifests and .NET project icons, Expo JSON config, Godot project settings, Linux desktop entries, configured Tauri/Electron icons, HTML favicons, web manifests and conventional app/logo assets. Apple, Expo and JetBrains icons can provide separate light/dark images. Android adaptive icons combine their background and foreground; ordinary vector drawable paths and groups are converted to SVG. Electron supports JSON build config, custom build-resource directories, extensionless paths and PNG-backed ICNS files. A bounded search covers monorepos, and Git worktrees can reuse assets from the primary checkout. GitLab/GitHub repository marks, a Git glyph or a folder serve as fallbacks.

Icon discovery stays offline and read-only. Images and metadata files are limited to 512 KiB, XML parsing and resource recursion are bounded, and paths must remain within the project/repository. Uploaded repository avatars, remote-only website icons and system-installed Linux theme assets are not fetched. JavaScript/TypeScript config files are never executed; dynamic Expo/Electron configuration and unsupported Android drawable effects use the next available local asset or repository fallback. The UI caches project icons for five minutes.

## Data and privacy

Tauri's application-data directory contains `usage.sqlite`, app-owned engine configuration and an empty isolated engine home. Open it from Settings → Privacy & data. Preferences, local titles, tags, favorites and aliases are independent of the usage snapshot. Clear cache removes reports but retains annotations. A complete rescan excludes deleted logs; cached snapshots are not a durable archive.

Prompt title fallback is enabled initially and limited to a sanitized 160-character title. Even these titles can be sensitive. Disable it and save to purge derived prompt titles. Native names and explicit local overrides remain. Diagnostics include only versions, platform, counts and error codes, not paths, IDs, titles or content. All scans pass `--offline`; pricing is the snapshot embedded in the pinned engine. Updating pricing requires rebuilding/updating that engine.

Default refresh is 60 seconds while a window is visible and 5 minutes when hidden/minimized, with debounced filesystem notifications and a single-flight scan guard. A visible Sessions screen keeps updating while another app has focus, including on a side monitor. Filesystem notifications and appended records detected by activity polling mark costs for refresh. Changed logs trigger a scan after five quiet seconds or roughly every ten seconds during continuous writes; costs update after each scan from the usage records providers have written. Engine processes use argument arrays, an isolated environment, bounded stdout/stderr, a 120-second timeout and cancellation. No shell command or general filesystem API is exposed to the webview.

## Architecture

- `src/`: React/TypeScript frontend; Tauri boundary in `lib/usage-api.ts`, shared query context, five screens, lightweight accessible CSS charts, original product icons and command palette.
- `src-tauri/src/core/`: pinned engine runner, strict usage adapter, metadata discovery, SQLite and report/filter/group/pagination functions.
- `src-tauri/src/ipc.rs`: typed commands, exports/native dialogs, scheduler and watcher.
- `src-tauri/src/tray.rs`: shared-snapshot tray summaries and lifecycle.
- `tests/fixtures/`: synthetic provider logs plus real pinned-engine JSON.
- `scripts/`: reproducible engine build and SPDX/license inventory.

See [the architecture decision](adr/001-engine-and-cache.md), [validation and remaining release checks](VALIDATION.md), [security policy](../SECURITY.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

## Compatibility and release status

The default engine is ccusage **20.0.48**, source revision `2c92293e0a1d6a395c6a10a23267855e3205a1a6`. Its JSON is experimentally verified in tests, including token totals and lifetime-vs-daily differences. Model-level totalTokens is not synthesized when absent. The pinned unified report does not expose every focused Codex fallback field.

A known upstream limitation affects Claude roots underneath an ancestor directory named `projects`; the app rejects these roots explicitly. Use the standard Claude config/home directory. Metadata scans buffer at most 1 MiB per JSONL record and read at most 512 MiB decompressed per file. Oversized or malformed records are skipped, scanning continues after the next newline, and metadata limits produce an explicit warning without rejecting ccusage’s usage totals. Affected sessions use last activity for date filtering, and incomplete first-activity/prompt metadata is omitted. Actual source access failures retain the previous snapshot as stale. Optional Codex SQLite schemas are probed read-only and can be skipped safely.

Current implementation omits optional chart PNG/PDF, column dragging, manual multi-path project groups, transcript search, start-at-login and locale overrides. Costs in reports and exports are scoped to the selected period; session details retain the lifetime value. Public signing/notarization, clean-machine checks and other-target installer validation are release tasks, not claimed as complete.

The shared build and release matrix targets macOS Apple Silicon, Windows x64 and Linux x64, using self-hosted runners for every job. macOS artifacts are `.dmg` and `.app.tar.gz`; Windows uses NSIS installers; Linux provides `.deb`, `.rpm` and AppImage. Intel Mac, Windows ARM64 and Linux ARM64 builds are paused. Version tags prepare a draft GitHub release after all three builds pass, with checksums, license notices and engine provenance. See [the release guide](RELEASING.md) for tagging, optional signing and publishing. The repository and draft releases are hosted at [huseyint/agent-usage](https://github.com/huseyint/agent-usage). Clean-machine validation remains pending.

New code is MIT licensed. Third-party copyright notices are retained; ccusage and dependency licenses are redistributed separately. This project is independent of OpenAI, Anthropic and ccusage maintainers.

Session liveness is a read-only, best-effort signal on the popover, Sessions list and Overview’s Top sessions. A pulsing green **Working** label means the Codex log contains an open turn with activity in the last two minutes. **Recent** means prompt/agent activity in the last 45 seconds when a lifecycle state is unavailable (including Claude Code). Explicit completion/abort records clear indicators. The app polls every three seconds while the relevant window is visible, including while another app has focus. It bootstraps from at most the last 8 MiB of a transcript, then reads appended records and preserves turn state between polls. Hidden/minimized windows stop activity polling; cached labels remain until completion or expiry. It does not install hooks or detect unsent typing. Archived/compressed/unavailable sources have no indicator. Long quiet tools, a start outside the initial bounded read, or more than 8 MiB appended between polls can fall back to Recent or no indicator; the label does not prove a provider process is still running.

## README screenshots

The README uses the real React screens with fictional local data, a fixed clock, mock project icons, and configured monthly allowances. Capture overrides are isolated to Playwright; the application and its normal browser preview keep their existing behavior. The preview labels are hidden only during capture.

```sh
pnpm exec playwright install chromium
pnpm dev
# In another terminal:
pnpm screenshots:readme
```

The script writes the three images to `docs/images/`, keeps intermediate captures in the ignored `.cache/readme-captures/` folder, and checks for working-session indicators, loaded project icons, allowance progress and browser runtime errors. Sessions uses pixel-aligned light and dark captures with a diagonal CSS clip. Set `APP_URL` to use a different local Vite address.
