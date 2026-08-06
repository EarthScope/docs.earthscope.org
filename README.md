# docs.earthscope.org

Source for [docs.earthscope.org](https://docs.earthscope.org), EarthScope's
technical documentation hub. The site is built using [MyST](https://mystmd.org/)
and hosts the top-level landing pages and links out to the docs for individual
tools (Services, Data, GeoLab), which live in their own repositories.

## Repo layout

- `intro.md`, `user_account.md`, `citation.md` — page content for this site.
- `myst.yml` — project config (title, table of contents).
- `es_config/earthscope.yml` — shared MyST config (theme, nav bar, logos)
  extended by this and other EarthScope docs repos.
- `es_config/search-widget.mjs` — custom search button/modal backed by a
  Google Programmable Search Engine.
- `scripts/build-docs.sh` — central build script, also fetched and run
  directly by the other EarthScope docs repos' Netlify builds.
- `scripts/fix-sitemap.mjs` — post-build fixup for `sitemap.xml`/`robots.txt`
  (myst-theme's static export hardcodes `localhost` as the origin) and
  merges in URLs from the other projects listed in `netlify.toml`.
- `netlify.toml` — Netlify build settings and the redirects that stitch the
  other EarthScope docs sites under `docs.earthscope.org/<path>`.
- `plugins/fanout/` — local Netlify build plugin that rebuilds the other
  EarthScope docs sites when the files they share with this repo change.

## Local testing

**Prerequisites:** Node.js (v24 to match Netlify, see `netlify.toml`).

Install [mystmd](https://mystmd.org/) (pinned version comes from
`scripts/build-docs.sh`):

```bash
npm install -g mystmd@~1.10.1
```

Start a live-reloading local server:

```bash
myst start
```

This serves the site at `http://localhost:3000` and rebuilds pages as you
edit them.

To reproduce the actual production build (static HTML export, plus the
sitemap/robots.txt fixups):

```bash
myst build --html
node scripts/fix-sitemap.mjs
```

Output goes to `_build/html`. Note that `fix-sitemap.mjs` fetches the
sitemap/robots.txt of every other project referenced in `netlify.toml`, so it
requires network access and those sites to be reachable.

### Local dev on the search widget

`es_config/earthscope.yml` points `navbar_end` at the raw GitHub URL for
`es_config/navbar_end_external.md` on `main`, so local edits to that file (or
to `search-widget.mjs`, which it references) won't show up in `myst start`
until pushed. To test search-widget changes locally, comment out that line
in `es_config/earthscope.yml` and uncomment the one below it that points at
the local `es_config/navbar_end.md` instead.

## Deployment

Netlify builds this repo (and the other EarthScope docs repos) by running
`scripts/build-docs.sh`, which installs the pinned `mystmd` version, runs
`myst build --html`, and — for the root project only — runs
`scripts/fix-sitemap.mjs`. See `netlify.toml` for build settings and
redirects.

### Propagating shared config to the other docs sites

The other repos pull `es_config/` over `raw.githubusercontent.com` and `curl`
`scripts/build-docs.sh` during their own builds, so changing either one here
leaves them stale until they rebuild. The `plugins/fanout` build plugin closes
that gap: after a successful production deploy, if either path changed since
the last build, it POSTs to each subsite's Netlify build hook.

Hook URLs are read from build-scoped environment variables, one per subsite,
named `SUBSITE_HOOK_<NAME>` (for example `SUBSITE_HOOK_GEOLAB`). Set them under
Project configuration → Environment variables, and mark them secret. With none
set, the plugin does nothing. Setting `DRY_RUN` to any non-empty value logs
which subsites would be triggered without firing the hooks.
