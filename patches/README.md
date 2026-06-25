# Patch Notes

## starlight-contextual-menu related patches

See `contributor-docs/workarounds/starlight-contextual-menu.md` for the full rationale and cleanup plan.

The upstream `starlight-contextual-menu` package is pinned to `astro@^5` and is
unmaintained for Astro 6, so it is no longer an npm dependency or patch target.
Its small source is vendored under `docs/src/plugins/starlight/contextual-menu/`;
the `injectMarkdownRoutes` flag that the old patch added now lives directly in the
vendored `index.js`.

### starlight-markdown@0.1.5.patch

This patch makes the upstream integration idempotent by skipping route injection after the first run. Third-party plugins (including the contextual menu) register the integration multiple times, and without this guard Astro sees the same static route twice and aborts the build.

### knip@5.80.0.patch

Treat package imports that resolve outside the configured knip root as external dependencies, so workspace links to parent repos don't get flagged as unused. See https://github.com/webpro-nl/knip/issues/1428. This is currently only needed when LiveStore is embedded in another monorepo.

## Sample format

```
### some-package@x.y.z.patch
Short explanation of why the patch exists, followed by a link to the canonical workaround/issue.
```
