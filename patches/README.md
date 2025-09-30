# Patch Notes

## starlight-contextual-menu related patches

See `contributor-docs/workarounds/starlight-contextual-menu.md` for the full rationale and cleanup plan.

### starlight-contextual-menu@0.1.3.patch
This patch adds option normalization plus an `injectMarkdownRoutes` flag so our docs can reuse the contextual menu integration without letting it reinject the Markdown routes that we already provide locally. Without the patch, the plugin always calls `starlightMarkdownIntegration`, causing duplicate `/index.md` routes and router collisions in Astro.

### starlight-markdown@0.1.5.patch
This patch makes the upstream integration idempotent by skipping route injection after the first run. Third-party plugins (including the contextual menu) register the integration multiple times, and without this guard Astro sees the same static route twice and aborts the build.

## Sample format

```
### some-package@x.y.z.patch
Short explanation of why the patch exists, followed by a link to the canonical workaround/issue.
```
