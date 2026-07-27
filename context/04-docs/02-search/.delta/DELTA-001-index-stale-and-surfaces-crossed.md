# DELTA-001 — The search index is stale and the two docs surfaces are crossed

Status: open

## Divergence

`LS.DOCS.SEARCH-R01` requires the index to update on every docs push (dev) and
every stable release (production), and that search never serves content older
than the latest stable docs. Reality, observed 2026-07-27:

- **One vector store exists**, `3c3548fb-f2e2-4a71-8080-bfbb0db03994`, named
  `livestore-docs-dev` and described as "development mode". Its last content
  update was 2026-04-27. It holds 101 files; 31 docs content files have changed
  since that date and none of those changes are indexed.
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

[../requirements.md](../requirements.md) `LS.DOCS.SEARCH-R01`. The requirement
is kept at the target; the failure is in the implementation, not the intent.
Related: the underlying provider configuration is undeclared, tracked as
[../../../03-delivery/04-infrastructure/.delta/DELTA-002-infrastructure-largely-undeclared.md](../../../03-delivery/04-infrastructure/.delta/DELTA-002-infrastructure-largely-undeclared.md).

## Implementation Contract

Ordered, because later steps are meaningless without the earlier ones:

1. Repair the `Setup pnpm` step in `sync-docs.yml` so the dev sync runs again,
   and make a failing sync visible rather than silent — three months of red
   push runs did not surface anywhere.
2. Decide whether production and development genuinely need separate indexes.
   If yes, create the production store and retire the bare
   `MXBAI_VECTOR_STORE_ID` alias in favour of the explicit `_DEV`/`_PROD` pair.
   If no, retire the `_DEV`/`_PROD` split and name the single store honestly.
3. Point each surface at the store its own sync path writes, and restore a
   working credential on the development surface.
4. Only then adopt the resulting configuration into declared state
   (`LS.DEL.INFRA-R04`) — adopting it beforehand would freeze the crossed
   wiring into the declaration.

Close this delta when a docs push is observably reflected in the surface that
push targets.
