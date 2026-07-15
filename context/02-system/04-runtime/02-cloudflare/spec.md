# Cloudflare Runtime — Spec

This document specifies the Cloudflare adapter
(`packages/@livestore/adapter-cloudflare`). It builds on
[requirements.md](./requirements.md); the mechanism-agnostic contract is in
[../spec.md](../spec.md).

## Status

Draft.

## Model

`createStoreDo` (`create-store-do.ts`) boots a full LiveStore client inside a
Durable Object:

```
Durable Object (one client)
  createStore(schema, adapter)          @livestore/livestore
    └─ makeAdapter(...)                 make-adapter.ts
         ├─ session SQLite (in-memory, DO storage-backed factory)
         ├─ makeLeaderThreadLayer       leader colocated in the DO
         │    ├─ dbEventlog / dbState   make-sqlite-db.ts (DO storage VFS,
         │    │                          CF_SQL_VFS_REQUIRED_PRAGMAS)
         │    └─ sync backend           via SYNC_BACKEND_DO RPC stub
         └─ ClientSessionLeaderThreadProxy (in-process)
```

Inputs: `schema`, `storeId`, `clientId`, `sessionId`, the DO's own
`ctx`/`env`/`bindingName` (so the sync backend can call back for live pull),
and `syncBackendStub` (`@livestore/sync-cf/cf-worker` RPC interface).
`livePull: false` is the default (LS.SYS.RT.CF-R03).

Persistence keys are versioned with `liveStoreStorageFormatVersion` and the
schema hash (migration strategy `manual` pins the suffix), so schema changes
recreate state rather than migrate it in place.

## Eviction and Resume

The DO adapter has no eviction-specific handling (no alarms, no hibernation
hooks): the store is created lazily per DO instance (typically cached on the
DO class between requests), leader and single client session are colocated
in the same isolate, and all persistence goes through the DO's SQL storage
(`ctx.storage`). Commits materialize and persist to the eventlog before the
background backend push, so an evicted DO recovers on the next request
through the ordinary leader boot rehydration path
([../spec.md](../spec.md) Leadership Handover): upstream head and pending
events are re-derived from DO storage and pending events are re-pushed.

## Open Design Questions

- **LS.SYS.RT.CF-DQ1 Platform durability assumptions.** Recovery relies on
  Cloudflare's DO storage write/output-gate durability semantics, which are
  external platform guarantees not verified in this repo; capture them as a
  `.reference/` record and state which commit-loss windows (if any) the
  adapter accepts.
