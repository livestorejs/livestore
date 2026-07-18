# Docs Search — Spec

This document specifies the docs search mechanics. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Mechanics

- Index backend: Mixedbread vector store.
- Dev index: `.github/workflows/sync-docs.yml` syncs on every push touching
  `docs/` (LS.DOCS.SEARCH-R01).
- Production index: synced by the stable-release deploy flow
  (`deploy-prod.yml` search target; runbook:
  [release-workflows-runbook.md](../../03-delivery/02-release/release-workflows-runbook.md)),
  so production search matches released docs, not `main`.
- Re-dispatching a failed search sync:
  `gh workflow run deploy-prod.yml -f target=search`.

## Open Design Questions

- **LS.DOCS.SEARCH-DQ1 Search UX ownership.** Result ranking, snippeting,
  and in-page search UI behavior are inherited from the search provider and
  Starlight defaults; whether the project owns any explicit UX contract
  beyond freshness is undecided.
