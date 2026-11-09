# Project website

A standalone static landing page for AI Coding Usage. No build, dependencies,
external fonts, analytics, or runtime API requests. JavaScript enhances the
screenshot selector and installation link; content and downloads work without it.

## Preview

From the project root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/website/>. Serving the repository root also verifies
that assets work beneath a subpath.

## Deploy to huseyint.com

Copy `index.html`, `styles.css`, `script.js`, and the entire `assets/` directory
into `agent-usage/` on the `gh-pages` branch of
<https://github.com/huseyint/huseyint.com>. The published URL will be
<https://huseyint.com/agent-usage/>.

For example, from this project's root, with a clean local checkout of that site
at `../huseyint.com` and its `gh-pages` branch checked out:

```sh
mkdir -p ../huseyint.com/agent-usage
cp website/index.html website/styles.css website/script.js ../huseyint.com/agent-usage/
cp -R website/assets ../huseyint.com/agent-usage/
```

Review, commit, and push those files in the site repository when ready. No changes
to its Jekyll configuration, root layout, or existing pages are required. This
HTML has no YAML front matter, so Jekyll copies it as-is.

Asset paths are relative, so the page can also be served from another subfolder.
If using a different public URL, update the canonical and Open Graph URLs in
`index.html`. No SPA routing or fallback configuration is needed.

## Maintenance

Download buttons point to the verified 1.0.0 release assets. For a new release,
update the badge, displayed version, download URLs, and filenames in `index.html`
together. Keep them pinned to a published release with matching assets.

Screenshots are copied from `docs/images/`. Refresh their copies in `assets/`
when those images change. The app icon comes from `assets/app-icon.svg` in the
project root; provider icons come from `src/assets/providers/`.
