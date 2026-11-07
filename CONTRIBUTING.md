# Contributing

This project is maintained by its author. Please use issues for bug reports and feature requests. Pull requests do not run CI on the maintainer's self-hosted runners; verification runs only for the owner's pushes to `main` and manual runs on `main`.

Development uses the existing React/TypeScript/Tauri stack and Node 26.13+ LTS. Keep new providers out of the initial release. New pricing must come from the pinned ccusage engine, not a parallel pricing calculator.

1. Install dependencies and build the host sidecar with `pnpm engine:build`.
2. Run `pnpm test` and `pnpm check` (Cargo must be on PATH).
3. Add synthetic fixtures for source/schema changes. Never commit real user logs, credentials, local databases or private screenshots.
4. Keep event-day reporting separate from session lifetime attribution, preserve raw totalTokens, and represent missing pricing explicitly.
5. Test native IPC, tray fallback, keyboard navigation and the 900×650 minimum layout. Run the cross-platform workflow before publishing installers.

Frontend code is formatted with Prettier; Rust uses cargo fmt. Preserve third-party attribution and license files. See docs/adr/001-engine-and-cache.md for architectural decisions and docs/VALIDATION.md for remaining release verification.

Release maintainers: see [docs/RELEASING.md](docs/RELEASING.md) for the three-target packaging matrix, signing secrets and draft-release process.
