# Starlight Markdown Customization

We keep a non-standard setup around Starlight's "Copy/View Markdown" feature so it works reliably in production.  The goal is to eventually drop every workaround and only use the upstream `starlight-contextual-menu` plugin.

## Why this exists

- The contextual menu (copy markdown) depends on the `starlight-markdown` integration to expose `*.md` routes for every page.
- The upstream integration currently resolves entries incorrectly during build (see issue [reynaldichernando/starlight-markdown#1](https://github.com/reynaldichernando/starlight-markdown/issues/1), PR [#2](https://github.com/reynaldichernando/starlight-markdown/pull/2)).  Until that lands we ship a local drop-in handler (`docs/src/plugins/starlight/markdown/*`) plus a Vite alias (`docs/astro.config.ts` lines ~320–334).
- Third-party plugins import `starlight-markdown` before Astro applies our alias, which re-introduces duplicate `/index.md` routes.  We patch both the contextual menu and `starlight-markdown` so repeated registration becomes a no-op (`patches/starlight-contextual-menu@0.1.3.patch`, `patches/starlight-markdown@0.1.5.patch`).
- Upstream tracking for contextual menu fix: issue [corsfix/starlight-contextual-menu#11](https://github.com/corsfix/starlight-contextual-menu/issues/11), PR [#12](https://github.com/corsfix/starlight-contextual-menu/pull/12).
- Local tracking issue: [livestorejs/livestore#699](https://github.com/livestorejs/livestore/issues/699).

## Current components

- Local integration: `docs/src/plugins/starlight/markdown/**`.
- Vite aliases: `docs/astro.config.ts` (`'starlight-markdown'` and `'@local/starlight-markdown'`).
- Upstream package patches registered in root `package.json`.
- `starlightContextualMenu({ injectMarkdownRoutes: false })` to prevent the plugin from reinjecting routes we already handle.

## Cleanup plan

1. Track upstream progress on [starlight-markdown#1](https://github.com/reynaldichernando/starlight-markdown/issues/1) / PR [#2](https://github.com/reynaldichernando/starlight-markdown/pull/2).  Once a fixed release ships:
  - Remove the local route handler and Vite alias.
  - Drop `patches/starlight-markdown@0.1.5.patch`.
2. Upstream a request to make `starlight-contextual-menu` skip markdown route injection (or detect duplicates) and remove `patches/starlight-contextual-menu@0.1.3.patch` once available.
3. After both patches disappear, revert the custom config call back to `starlightContextualMenu()`.

Until then, keep the documentation and patches in sync whenever the packages are updated.
