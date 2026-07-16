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

## Platform Adaptations

Colocation and the `SqlStorage` API force several degenerate or adapted
behaviors versus the portable contract:

- **No shutdown channel** — `WebChannel.noopChannel`; with a single context
  there is nothing to broadcast to (degenerate case of LS.SYS.RT-R06).
- **Devtools disabled** — `devtoolsOptions.enabled` is hardcoded false; the
  websocket webmesh connect is commented out (stub). `webmeshMode` is
  `'proxy'` (web adapters use `'direct'`).
- **Transaction control is dropped** — `BEGIN`/`COMMIT`/`ROLLBACK`/
  `SAVEPOINT` statements are silently discarded on the `SqlStorage` path
  (`make-sqlite-db.ts`). Safe because the eventlog is append-only and
  idempotent, state is rebuildable, and the DO is single-threaded — but it
  means SQLite transaction semantics do not exist on this realization.
- **`export()`/`import()` are no-ops** — `SqlStorage` has no
  serialize/deserialize; the session's initial snapshot import is therefore
  also a no-op (leader and session share the isolate anyway).
- **`resetPersistence` spans three tables** — `vfs_pages` (state VFS),
  `eventlog`, and `__livestore_sync_status` (direct), inside
  `storage.transactionSync`.

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

- **LS.SYS.RT.CF-DQ1 Accepted commit-loss window.** The platform durability
  semantics recovery relies on (output gate, disk-flush confirmation,
  eviction) are captured in
  [.reference/cloudflare-do-durability.md](./.reference/cloudflare-do-durability.md).
  That record identifies the residual window: progress committed to the
  in-isolate write buffer and acked only to the colocated in-process session
  (`ClientSessionLeaderThreadProxy`, not output-gated) but not yet flushed to
  disk is lost on abrupt isolate termination — never externally observable,
  since any outbound network message is output-gated on the flush. Open: a
  requirements decision on whether this window is acceptable as-is (default),
  or whether the adapter must force a `ctx.storage.sync()` before acking a
  commit to the session to close it. The reference also flags one
  platform-trust unknown a requirement may need to constrain: whether
  "confirmed flushed to disk" implies geo/replicated durability or
  single-node disk.
