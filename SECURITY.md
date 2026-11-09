# Security and privacy

Agent logs, native titles and derived display titles may be sensitive. Do not include real logs, source paths, user names, titles, IDs, screenshots or tokens in public issues. Use the synthetic fixtures and Settings → Privacy & data → Safe diagnostics.

No telemetry, transcript upload, credential access or network pricing lookup is enabled. The engine runs offline, with an isolated home directory and explicit source roots. Claude and Codex sources are read-only. Optional Codex SQLite indexes are opened read-only with a short busy timeout. User metadata is stored only in the app-owned SQLite database.

External engines are executable code selected by the user. Choose only trusted binaries. Matching a version string verifies schema compatibility, not executable integrity. The app invokes argument arrays without a shell, bounds output, limits duration, supports cancellation and terminates process groups. Capabilities do not expose shell execution or arbitrary filesystem reads to the webview.

Report security concerns through [GitHub's private vulnerability reporting form](https://github.com/huseyint/agent-usage/security/advisories/new). Do not post exploits containing private data in public issues or discussions.

Verification runs on the maintainer's self-hosted runners only for the repository owner's pushes to `main` and manual runs on `main`. Pull requests do not trigger these runners. Release builds run only from maintainer-controlled tags or manual release dispatches.

Only the current 1.0 release line is supported. Review platform installers/signatures before public release. Distributed builds in this workspace are unsigned development builds; signing/notarization is not claimed.

The Linux GTK3 dependency includes a local backport of the upstream fix for RUSTSEC-2024-0429. See [the source and patch provenance](vendor/README.md). The upstream crate version is preserved, so version-based scanners may still flag it. This backport does not resolve the separate maintenance advisories in the GTK3/D-Bus dependency tree.
