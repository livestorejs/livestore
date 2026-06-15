# Starlight Markdown Customization

We keep a non-standard setup around Starlight's "Copy/View Markdown" feature so it works reliably in production.

> Astro 6 note: `starlight-contextual-menu` is pinned to `astro@^5` and is unmaintained for
> Astro 6, so it is no longer an npm dependency. Its small (MIT) source is vendored under
> `docs/src/plugins/starlight/contextual-menu/`. The vendored `index.js` imports the local
> `starlight-markdown` drop-in directly and honours `injectMarkdownRoutes: false` (the
> behaviour the old `patches/starlight-contextual-menu@0.1.3.patch` provided, now removed).
> `astro.config.ts` imports the vendored plugin.

## Why this exists

- The contextual menu (copy markdown) depends on the `starlight-markdown` integration to expose `*.md` routes for every page.
- The upstream integration currently resolves entries incorrectly during build (see issue [reynaldichernando/starlight-markdown#1](https://github.com/reynaldichernando/starlight-markdown/issues/1), PR [#2](https://github.com/reynaldichernando/starlight-markdown/pull/2)). Until that lands we ship a local drop-in handler (`docs/src/plugins/starlight/markdown/*`) plus a Vite alias (`docs/astro.config.ts` lines ~320–334).
- Third-party plugins import `starlight-markdown` before Astro applies our alias, which re-introduces duplicate `/index.md` routes. The vendored contextual menu skips route injection (via `injectMarkdownRoutes: false`); `starlight-markdown` itself remains idempotent via `patches/starlight-markdown@0.1.5.patch`.
- Upstream tracking for contextual menu fix: issue [corsfix/starlight-contextual-menu#11](https://github.com/corsfix/starlight-contextual-menu/issues/11), PR [#12](https://github.com/corsfix/starlight-contextual-menu/pull/12).
- Local tracking issue: [livestorejs/livestore#699](https://github.com/livestorejs/livestore/issues/699).

## Current components

- Local markdown integration: `docs/src/plugins/starlight/markdown/**`.
- Vendored contextual menu: `docs/src/plugins/starlight/contextual-menu/**`.
- Vite alias: `docs/astro.config.ts` (`'starlight-markdown'`).
- `starlightContextualMenu({ injectMarkdownRoutes: false })` to prevent the plugin from reinjecting routes we already handle.

## Cleanup plan

1. Track upstream progress on [starlight-markdown#1](https://github.com/reynaldichernando/starlight-markdown/issues/1) / PR [#2](https://github.com/reynaldichernando/starlight-markdown/pull/2). Once a fixed release ships:

- Remove the local route handler and Vite alias.
- Drop `patches/starlight-markdown@0.1.5.patch`.

2. Once `starlight-contextual-menu` (or a maintained fork) supports Astro 6 and can skip
   markdown route injection, drop the vendored copy under
   `docs/src/plugins/starlight/contextual-menu/` and depend on the published package again.

Until then, keep the documentation and the vendored sources in sync whenever the packages are updated.
