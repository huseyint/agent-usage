# Third-party notices

The following portions include MIT-licensed code by Kamran Ahmed:

- `src-tauri/src/traffic_lights.rs`: native title-bar alignment.
- `src/components/glyphs.tsx`: a subset of the custom SVG glyphs and their rendering helpers.
- `src/styles/app.css`: light/dark color tokens, shell proportions, control styling, and release-card dialog styling.
- `src/components/whats-new-dialog.tsx`: What’s New layout and inline note presentation, adapted from `src/features/whats-new/whats-new-dialog.tsx`.
- `src/components/app-shell.tsx`: layout patterns adapted from the activity rail, title bar, sidebar frame and view tabs.

The copyright and license below apply to these adapted portions.

MIT License

Copyright (c) 2026 Kamran Ahmed

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Repository icons

The GitLab logomark in `src/assets/repositories/gitlab.svg` comes from the
[GitLab press kit](https://about.gitlab.com/press/press-kit/),
`https://about.gitlab.com/images/press/gitlab-logo-500-rgb.svg`, with its view box
trimmed to remove surrounding whitespace. The GitHub mark in
`src/assets/repositories/github.svg` comes from
`https://github.githubassets.com/favicons/favicon.svg`.
These marks identify repository hosts and remain trademarks of their owners.
Project-specific icons are read from the user's local projects at runtime.

## glib security backport

The Linux GTK3 dependency uses a local copy of MIT-licensed `glib 0.18.5` with
the upstream fix for RUSTSEC-2024-0429. Source provenance and the exact change
are documented in `vendor/README.md`; the original license is preserved in
`vendor/glib/LICENSE` and included in the generated dependency notices.

## ccusage

The bundled standalone executable is built from ccusage 20.0.48, revision
`2c92293e0a1d6a395c6a10a23267855e3205a1a6`, under the MIT license.
The complete upstream license is in `docs/CCUSAGE_LICENSE` and is included in
application bundles as `CCUSAGE_LICENSE`.

The executable embeds pricing snapshots from the pinned LiteLLM input recorded
in its provenance JSON and from models.dev data committed at that ccusage revision.
Pricing snapshots may be stale and do not represent subscription billing.

Run `pnpm licenses:generate` after building the engine to generate `docs/SBOM.spdx.json` and
`docs/DEPENDENCY_LICENSES.txt`, including native app, frontend and engine dependency
licenses. Release CI runs this before packaging and includes these notices as resources.
## Provider icons

The Claude mark in `src/assets/providers/claude.svg` is sourced from
<https://claude.ai/favicon.svg>. The Codex light and dark application icons are
original assets from OpenAI’s desktop application (`icon-codex-light.png` and
`icon-codex-dark-color.png`). The compact mark in `src/assets/providers/codex.svg`
is a simplified vector adaptation of that application's cloud and terminal mark,
with the desktop tile and shadow omitted for legibility at small sizes.
Claude and its mark belong to Anthropic; Codex and its marks belong to OpenAI.
These marks identify local usage sources and are not covered by this project's
MIT license. Their use does not imply affiliation or endorsement.
