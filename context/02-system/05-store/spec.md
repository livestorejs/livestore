# Store — Spec

This document specifies the Store surface, commit path, lifecycle, and
multi-store registry (`packages/@livestore/livestore`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: Store API shape, creation options, commit path, lifecycle, store
registry. Does not define: the reactive layer
([01-reactivity/](./01-reactivity/spec.md)), event/materializer semantics
(`../01-event-model/`, `../02-state/`), sync semantics (`../03-sync/`),
framework bindings (`../08-integrations/`).

## Store Surface

`Store<TSchema, TContext>` (`src/store/store.ts`) is created via
`createStore` from a schema plus an adapter (which boots the client session,
see `../04-runtime/`). Members (`store.ts`):

- Reads/writes: `query`, `subscribe`, `commit`, `setSignal`,
  `manualRefresh`.
- Event access: `events` and `eventsStream`.
- Sync/network: `networkStatus` (property), `syncStatus()` (synchronous
  snapshot), `syncStatusStream`, `subscribeSyncStatus`.
- Identity/environment: `storeId`, `clientId`, `sessionId`, `storageMode`
  (persisted vs in-memory fallback, e.g. Safari/Firefox private browsing —
  `store.ts:166-207`; LS.SYS.STORE-R12).
- Lifecycle: `shutdown`, `shutdownPromise`; debug: `_dev.*`, devtools wiring
  (`src/store/devtools.ts`).

The Effect-native binding (`Store.Tag`) is a realization of the integration
contract — see
[../08-integrations/02-effect/](../08-integrations/02-effect/spec.md).

### Creation options

`createStore` / `RegistryStoreOptions` (`src/store/create-store.ts`):
`boot(store, { migrationsReport, parentSpan })` hook, `onBootStatus`,
`syncPayload` + `syncPayloadSchema` (encoded before crossing to the
adapter), `confirmUnsavedChanges` (web `beforeunload`), `disableDevtools`
(default `'auto'`), `params.{leaderPushBatchSize, eventQueryBatchSize,
simulation}`, `debug.instanceId`, `shutdownDeferred`, `signal`
(`AbortSignal`), `logger`/`logLevel`, `unusedCacheTime` (registry, below).
`storeId` must match `/^[a-zA-Z0-9_-]+$/` (`create-store.ts:456`).

## Commit Path

The pipeline is fully synchronous, run via `Effect.runSyncWith`
(`store.ts:945`):

1. Validate and encode events against their definitions; assign client
   sequence numbers.
2. Materialize into the session SQLite database — wrapped in a SQLite
   transaction only when the batch has more than one event (`store.ts:899`);
   single events rely on per-statement atomicity (LS.SYS.STORE-R04).
3. Push the batch to the `ClientSessionSyncProcessor` (leader forwarding,
   `../03-sync/`).
4. Refresh the reactivity graph (`setRefs`; guarantees in
   [01-reactivity/](./01-reactivity/spec.md)). The push precedes the local
   refresh (`store.ts:891-921`).

**A failed local commit is fatal to the store**: the commit path catches the
cause and forks `store.shutdown` rather than throwing a recoverable error to
the caller (`store.ts:944`; LS.SYS.STORE-R09).

Telemetry: long-lived `LiveStore:commits`/`LiveStore:queries` spans plus a
per-commit root span with links.

## Lifecycle

- Every public operation guards on `isShutdown` (`checkShutdown`).
- `shutdown` first drains admitted client-session events to the leader, then
  closes the store's `lifetimeScope`. Its 1s timeout limits how long the caller
  waits without cancelling cleanup; intentional shutdown is distinguished
  from failure via the Exit cause (LS.SYS.STORE-R07,
  LS.SYS.SYNC.PROC-R03).
- During boot, `batchUpdates` is the identity function and is swapped to the
  adapter-provided implementation after boot (`create-store.ts:399,430`) —
  events committed during boot are unbatched.
- `setSignal` before/while the reactive graph is externally retained relies
  on an `rc > 1` guard to avoid losing the set value
  (`store.ts:797-804`; acknowledged fragile in code, issue #1419).

## Multi-Store (StoreRegistry)

`StoreRegistry` (`src/store/StoreRegistry.ts`) manages concurrent stores
with reference counting (LS.SYS.STORE-R06); framework integrations
acquire/release through it. Context: RFC 0001 (multi-store API design) — a
fold-in candidate per decision 0002. Where the implementation diverges from
RFC 0001, the implementation is the contract:

- **Cache identity is `storeId` alone** (`StoreRegistry.ts:120-139`):
  loading the same `storeId` with a different adapter/schema silently
  returns the first store (LS.SYS.STORE-R10).
- **`unusedCacheTime` is fixed at first load** (`StoreRegistry.ts:74`), not
  longest-wins as RFC 0001 §cache-time proposed (the longest-wins test is
  `it.skip`; LS.SYS.STORE-R11).
- Defaults: 60s in the browser, `Infinity` under SSR.
- Disposal API is `dispose()` (RFC 0001 called it `clear()`).
- `getOrLoadPromise` returns synchronously for a cached store and a
  `Promise` otherwise (sync-or-Promise duality via `AsyncFiberError`,
  `StoreRegistry.ts:275-305`) — the basis of the React suspense contract.

## Open Design Questions

- **LS.SYS.STORE-DQ1 Commit confirmation surface.** `store.commit` returns
  `void` (or a `Promise`); it exposes no handle to await leader-thread
  materialization or sync-backend confirmation. Whether it should return such a
  receipt is open, and is gated by the command/intent design (root LS-DQ1):
  command replay can reject a pending commit during reconciliation, so the
  confirmation surface cannot be specified independently. A concrete design, if
  pursued, belongs in an RFC (per
  [decision 0004](../../.decisions/0004-rfc-vrs-boundary.md)). `../03-sync/`
  LS.SYS.SYNC-DQ1 cross-references this.
