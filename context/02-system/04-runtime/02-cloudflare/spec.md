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

Inputs: `schema`, `storeId`, `clientId`, `sessionId`, the DO's own `ctx`, and
`syncBackendStub` (`@livestore/sync-cf/cf-worker` RPC interface).
`livePull: false` is the default (LS.SYS.RT.CF-R03).

`createStoreDo.params.stateRebuildBatchSize` forwards the per-client rebuild
setting. A Durable Object can choose a smaller batch than clients with more
memory, trading lower per-batch resource use for more queries, savepoints and
storage writes. The event-count limit is not a whole-isolate memory guarantee.

Persistence keys are versioned with `liveStoreStorageFormatVersion` and the
schema hash, so schema changes recreate state rather than migrate it in
place.

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
  Why the state DB runs WASM SQLite over a VFS instead of `SqlStorage`
  directly is recorded in
  [.decisions/0001-sqlite-over-vfs.md](./.decisions/0001-sqlite-over-vfs.md).
- **`export()`/`import()` are no-ops** — `SqlStorage` has no
  serialize/deserialize; the session's initial snapshot import is therefore
  also a no-op (leader and session share the isolate anyway).
- **`resetPersistence` spans four tables** — `vfs_pages` (state VFS),
  `__livestore_state_files` (adapter ownership), `eventlog`, and
  `__livestore_sync_status` (direct), inside
  `storage.transactionSync`.

## Obsolete State Cleanup

Before opening a state database, register its exact VFS path in the adapter-owned
`__livestore_state_files` table. Registration failure stops boot before opening the
file. Existing registrations are reused without writing rows. This registry is
adapter metadata, separate from the eventlog and the materialized state schema.

After adapter boot succeeds, remove pages belonging to other registered paths
and their ownership records together in `storage.transactionSync`. Keep the
current state, unregistered VFS files, eventlog and sync metadata. Failed replay
or migration hooks retain every registered file. Cleanup failure logs a warning
and leaves completed state available, with ownership intact for retry on the
next successful boot. Run cleanup on completed-state reuse too.

Filename shape is not proof of ownership. Old files that predate registration
remain untouched unless the adapter subsequently opens and registers that exact
file. Consequently this prevents new orphan accumulation without automatically
reclaiming all historical orphans. See
[the ownership decision](./.decisions/0002-state-file-ownership.md).

Once clean, later boots write no rows for registration or cleanup. Deleting a
previous state means returning to that schema rebuilds from the eventlog. Cleanup
consumes billed row writes and does not explicitly compact the underlying DO
database. Because it follows successful boot, it cannot recover a database that
is already too full to rebuild.

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

**Maturity: experimental.** Live-pull delivery has its own reconstruction
path. The client mints a persistent stub with
`ctx.restore({ storeId, subscriptionId })`; the backend stores the stub and
invokes it only when publishing an update. The client DO's `[restore]` returns
`restoreStoreDoSyncTarget(ctx, params, { onUpdate })`. The target checks that
the subscription is still current, runs `onUpdate(storeId)` so a store-less
wake can re-boot and catch up, checks again in case boot superseded the old
pull, and then routes the bytes to the live-pull queue. A stale target refuses
delivery so the backend removes its row. This preserves eviction recovery
without a forgeable DO id or an idle stub that pins either DO awake
(LS.SYS.RT.CF-R03; [provider decision
0006](../../03-sync/03-cf/.decisions/0006-persistent-stub-subscriptions.md)).

## Open Design Questions

- **LS.SYS.RT.CF-DQ2 Free-plan capacity and memory headroom.** The adapter should
  support representative workloads on Workers Free with substantial memory
  headroom for application state and concurrent work. The supported workload
  envelope and regression budget are not yet established: local full-boot
  profiles for several replay fixtures exceed the documented isolate ceiling,
  even with 100-event replay batches. Track production-equivalent profiling,
  allocation reduction and deployed validation in
  [#1612](https://github.com/livestorejs/livestore/issues/1612). Account-wide
  read/write quotas must also leave room for normal operation; batch size alone
  cannot guarantee Free-plan compatibility.
- **LS.SYS.RT.CF-DQ1 Flush durability scope.** The commit-loss window is
  decided (accepted; LS.SYS.RT.CF-R06). What remains platform-trust: whether
  Cloudflare's "confirmed flushed to disk" implies geo/replicated durability
  or single-node disk — undocumented upstream (see
  [.reference/cloudflare-do-durability.md](./.reference/cloudflare-do-durability.md)).
  Blocked on: upstream documentation or vendor confirmation.
