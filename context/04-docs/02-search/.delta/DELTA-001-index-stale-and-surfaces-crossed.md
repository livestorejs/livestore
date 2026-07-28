# DELTA-001 — The search index is stale and the two docs surfaces are crossed

Status: open — largely remediated 2026-07-27; one observable step outstanding.

## Divergence

`LS.DOCS.SEARCH-R01` requires the index to update on every docs push (dev) and
every stable release (production), and that search never serves content older
than the latest stable docs. Reality, observed 2026-07-27:

- **One vector store existed**, `3c3548fb-f2e2-4a71-8080-bfbb0db03994`, named
  `livestore-docs-dev` and described as "development mode". Its content had not
  been refreshed since roughly 2026-04, evidenced by the sync workflow failing
  on every run since then rather than by the store's `updated_at`, which tracks
  store metadata and not file operations.
- **Both docs surfaces read that one store.** `docs.livestore.dev`
  (`livestore-docs`) and `dev.docs.livestore.dev` (`livestore-docs-dev`) each
  set `MXBAI_VECTOR_STORE_ID` to it for all contexts. Production search is
  therefore served from a store named and described as the development index.
- **`.github/workflows/sync-docs.yml` fails on every push run**, and has since
  roughly 2026-04. The failing step is `Setup pnpm` — the job dies at
  environment setup and never reaches the vector-store sync. This is the
  proximate cause of the staleness: the dev sync path has not run successfully
  in about three months.
- **`MXBAI_VECTOR_STORE_ID_PROD` names no existing store.** The production sync
  path in `deploy-prod.yml` instead uses the bare `MXBAI_VECTOR_STORE_ID`, so
  the two sync paths disagree about which store is production while only one
  store exists at all.
- **Search on the dev surface is down.** `dev.docs.livestore.dev/api/search`
  returns HTTP 500; the credential that surface holds is rejected by the
  Mixedbread API. The production surface returns results normally.

The `dev`/`prod` split introduced for search targets therefore exists only in
the write path. No surface reads a store that its own sync path writes, which
is the invariant the split was meant to establish.

## VRS

[../requirements.md](../requirements.md) `LS.DOCS.SEARCH-R01` (freshness) and
`LS.DOCS.SEARCH-R03` (each surface searches its own content). Both are kept at
the target; the failure is in the implementation, not the intent.
Related: the underlying provider configuration is undeclared, tracked as
[../../../03-delivery/04-infrastructure/.delta/DELTA-002-infrastructure-largely-undeclared.md](../../../03-delivery/04-infrastructure/.delta/DELTA-002-infrastructure-largely-undeclared.md).

## Implementation Contract

Applied 2026-07-27:

1. `sync-docs.yml` now generates from `sync-docs.yml.genie.ts` on the shared
   devenv/nix setup, removing the pnpm pin that broke it, and selects its target
   with two gated jobs so a missing store id fails loudly instead of silently
   falling back to a legacy store. Merged as livestorejs/livestore#1507.
2. Two stores now exist — `livestore-docs-prod` (released docs, populated from
   `v0.4.0`) and `livestore-docs-dev` (refreshed from `main`) — and the
   `MXBAI_VECTOR_STORE_ID_DEV` / `_PROD` secrets that the workflow had always
   referenced were created for the first time.
3. Each surface points at its own store. The development surface's Mixedbread
   credential was invalid and was replaced with the canonical 1Password value,
   now stored using Netlify's secret mechanism (`LS.DEL.INFRA-R06`) rather than
   as plain configuration.

Both surfaces now return results: production from the production store,
development from the development store.

Outstanding, and why this delta stays open:

- **The production sync path has never run successfully.** The production store
  was populated by hand so the surface would not serve a stale index; the
  release pipeline that is supposed to maintain it is now wired correctly but
  unproven. `LS.DOCS.SEARCH-R01` promises the index updates on every stable
  release, and that promise is still untested.
- **Silent failure remains possible.** The proximate bug was a stale pnpm pin,
  but the reason it survived three months is that a failing sync surfaced
  nowhere. Detection belongs with the disabled alignment-notification job
  (livestorejs/livestore#1183) rather than a mechanism invented here.

Close this delta once a stable release has refreshed the production index
without manual intervention.
