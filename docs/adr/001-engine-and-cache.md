# ADR 001: pinned native engine and rebuildable local cache

Status: accepted for 0.1.0.

The desktop application uses React, TypeScript, Vite and Tailwind for the frontend, Zustand for UI preferences, TanStack Query for native data access, and Tauri 2 for native operations. Native menus, window-state persistence and macOS title-bar integration are part of the application shell. Adapted components and their licenses are listed in THIRD_PARTY_NOTICES.md.

ccusage 20.0.48 is pinned to `2c92293e0a1d6a395c6a10a23267855e3205a1a6`. Its current upstream contains a Rust standalone CLI. Build that source using its Cargo.lock and build-time pricing inputs; do not embed a JavaScript runtime or download an engine at app startup. Verify each target in CI. External executables are opt-in, absolute paths and must report the verified version. A version string cannot establish trust in a user-selected binary.

A unified `daily --sections daily,session --by-agent --json --breakdown --offline --mode … --timezone … --config …` report supplies actual event-day totals, session lifetime totals, and priced model breakdowns. Upstream's unified session key is **session** (singular), not sessions. Focused Codex JSON has a different models map without per-model costs; it is not substituted for the unified schema. The adapter rejects required-field changes. Model-level totalTokens is optional and is not reconstructed. isFallback is retained when emitted; the pinned unified report does not currently emit it.

Run one unified report per canonical source root in an isolated environment. This prevents native-ID collisions across installations and stops other providers from being discovered through the real home directory. Root namespaces are hashed; project identities retain canonical paths. Overlapping roots are collapsed before execution. Cross-root copied logs are separate installations and may be duplicate usage; users should configure only authoritative roots.

Each snapshot replaces the prior snapshot atomically in SQLite, alongside separate annotations/preferences/project aliases and a bounded refresh-run history. This intentionally refines the proposed normalized schema into one current typed JSON snapshot, avoiding a second aggregation authority. Reports and pagination are computed in Rust. It is suitable for 10k sessions; larger data sets may justify normalized query tables later. Costs use integer micro-USD, so reconciliation tolerance is 0.5 micro-USD per normalized row; raw token totals are preserved. No floating-point dollar aggregates are persisted.

Title extraction stores bounded display strings and provenance, never complete prompts. Streamed metadata scans retain IDs, timestamps, local project/source paths and activity days. Native titles take precedence over generated summaries and prompt fallback. Codex index, optional read-only state SQLite and rollout metadata are layered. Unknown SQLite schemas are skipped. Prompt fallback opt-out purges derived titles from the snapshot, while user overrides remain independent.

The pinned upstream derives Claude session paths from the first ancestor named `projects`. A custom Claude config nested under another `projects` directory can therefore group sessions incorrectly. Reject that known case with SOURCE_PATH_INCOMPATIBLE rather than displaying misleading totals; standard ~/.claude and ~/.config/claude are unaffected.

No daily record before the earliest recorded date establishes coverage. Charts show that interval as no recorded coverage. Zeros within the observed interval mean no recorded events, not proof of complete provider history. Comparisons are N/A if the preceding interval lacks recorded coverage or has a zero denominator.

The release workflow builds and tests installers on native runners for each supported OS and architecture. Signing configuration and clean-machine checks are described in [the release guide](../RELEASING.md).
