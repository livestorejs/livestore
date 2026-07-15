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

## Open Design Questions

- **LS.SYS.RT.CF-DQ1 Eviction/resume guarantees.** What the DO client
  guarantees about in-flight commits across DO eviction is implemented but
  not yet stated testably.
