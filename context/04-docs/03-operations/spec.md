# Docs Operations — Spec

This document specifies the docs-site operational surfaces. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Deploy Contract (LS.DOCS.OPS-R02)

Netlify serves the site (Astro SSR) with the `markdown-negotiation` edge
function in front (`docs/netlify.toml`); deploys and CDN purges run through
the delivery release pipeline. The authoritative mechanics (heap limits,
`DT_PASSTHROUGH`, purge steps, re-dispatch) live in the release runbook —
this node intentionally does not duplicate them.

## Machine-Readable Docs (LS.DOCS.OPS-R01)

- `markdown-negotiation` edge function: clients preferring markdown (via
  `Accept`) receive the page's `.md` rendering; `Vary` is appended so CDN
  caching stays correct.
- `docs-export` (`scripts/src/commands/docs-export.ts`) produces the bulk
  markdown export consumed by agents/LLM tooling.

## Docs Testing (LS.DOCS.OPS-DQ1)

Current reality: one Playwright spec guarding a Starlight contextual-menu
workaround. No link-check, no build-smoke contract beyond the (optional)
docs build job — see
[../.delta/DELTA-001-docs-gates-optional.md](../.delta/DELTA-001-docs-gates-optional.md).
