# AI Coding Usage

A desktop dashboard for Claude Code and OpenAI Codex. See your sessions, token usage and estimated costs in one place, with a quick view in your menu bar or system tray.

![Sessions in light and dark themes](docs/images/sessions.png)

## Features

- **Sessions** — Search, filter and group conversations by date, project or provider. See which sessions are working, add local titles and tags, and favorite useful conversations.
- **Overview** — Explore daily, weekly and monthly usage, provider totals, top projects and model breakdowns.
- **Menu bar & system tray** — Check today’s usage and recent sessions without opening the dashboard.
- **Monthly allowances** — Set a budget for each provider and follow estimated spend in the sidebar.
- **Local and private** — Reads your existing logs without changing them. No account, API keys, telemetry or uploads.
- **Make it yours** — Light and dark themes, project icons, custom source folders, and CSV or JSON exports.

Costs are estimated USD API-equivalent token values, not subscription bills or provider quota usage.

## Install

Download installers from [Releases](https://github.com/huseyint/agent-usage/releases):

| Platform | Download |
| --- | --- |
| macOS · Apple Silicon | `.dmg` |
| Windows · x64 | `.exe` |
| Linux · x64 | `.AppImage`, `.deb` or `.rpm` |

Signing, notarization and clean-machine validation are still pending. See the [release guide](docs/RELEASING.md) for build and signing details.

## Use

1. Open the app and connect Claude Code, Codex, or both. Standard local folders are detected automatically; add custom folders in **Settings → Sources**.
2. Refresh to load your usage, then choose a provider and date range.
3. Browse **Sessions** for individual conversations, **Overview** for trends, or **Projects** and **Models** for breakdowns. Click a session for details.
4. Set monthly allowances in **Settings → Engine & costs** to show progress in the sidebar. Click the menu bar or tray icon for a quick check.

Reports show costs within the selected dates. Session details also include lifetime cost. **Working** is a best-effort signal from recent log activity.

### Overview

![Usage overview in the light theme](docs/images/overview.png)

### Menu bar

![Menu bar popover with today’s usage and a working session](docs/images/menubar.png)

## Development

Requires Node 26.13+ LTS (the exact development and CI version is in `.node-version`), pnpm, stable Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm engine:build
pnpm desktop
```

For a browser preview with mock data, run `pnpm dev`. Run `pnpm test` and `pnpm check` before contributing.

See [Contributing](CONTRIBUTING.md), the [detailed reference](docs/REFERENCE.md), [architecture](docs/adr/001-engine-and-cache.md), and [release validation](docs/VALIDATION.md).

## License

[MIT](LICENSE). Built with [ccusage](https://github.com/ccusage/ccusage); see [third-party notices](THIRD_PARTY_NOTICES.md). Independent of OpenAI and Anthropic.
