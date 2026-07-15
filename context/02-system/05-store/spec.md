# Store — Spec

This document specifies the Store surface and reactivity system
(`packages/@livestore/livestore`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: Store API shape, commit path, reactivity graph, live query kinds,
store registry. Does not define: event/materializer semantics
(`../01-event-model/`, `../02-state/`), sync semantics (`../03-sync/`),
framework bindings (`../08-integrations/`).

## Store Surface

`Store<TSchema, TContext>` (`src/store/store.ts`) is created via
`createStore` from a schema plus an adapter (which boots the client session,
see `../04-runtime/`). Core members: `query`, `subscribe`, `commit`,
`events`/`eventStream`, `syncState`/`networkStatus` (via the leader proxy),
`shutdown`/`shutdownPromise`, devtools wiring (`src/store/devtools.ts`). An
Effect-native surface exists at `src/effect/LiveStore.ts`.

## Commit Path

1. `store.commit(...events)` validates events against their definitions and
   assigns client sequence numbers.
2. Events materialize synchronously into the session SQLite database in one
   transaction (LS.SYS.STORE-R04); affected reactivity-graph nodes refresh.
3. The `ClientSessionSyncProcessor` forwards the batch to the leader; the
   leader persists, materializes, and pushes upstream (`../03-sync/`).

**Maturity: proposal** — `store.commit` returning a receipt with
leader/backend confirmation awaitables is proposed in
`wip/upcoming-specs/store-commit-receipt.md`.

## Reactivity Graph

`src/reactive.ts` + `src/live-queries/base-class.ts` implement a
signals-based incremental graph (Adapton-inspired, eager — no lazy
recomputation): nodes are queries, computeds, and signals; edges are read
dependencies. Commits set the affected table refs; query instances are
deduplicated through `QueryCache` (`src/QueryCache.ts`) with write tracking
in `SqliteDbWrapper`.

Update guarantees (`reactive.ts`):

- **Synchronous and eager:** a ref update refreshes the graph before
  `setRef(s)` returns; there is no scheduler or microtask deferral.
- **Atomic per commit:** one commit sets all written table refs in a single
  `setRefs` batch, producing exactly one refresh pass regardless of how many
  tables the events touched.
- **Glitch-free:** refresh proceeds in topological sort order (heights
  maintained eagerly as edges change), so a node never observes a mix of
  old and new inputs.
- **Equality cutoff:** each thunk compares against its previous result and
  stops propagation when equal.
- **Opt-out:** `commit({ skipRefresh: true }, …)` defers the refresh to a
  later manual refresh / `runDeferredEffects` pass; subscriber effects run
  through the adapter-provided `batchUpdates` wrapper (e.g. React's
  `unstable_batchedUpdates`).

| Kind | Constructor | Notes |
| --- | --- | --- |
| Db query | `queryDb()` | SQL/query-builder over state; typed result schema |
| Computed | `computed()` | Pure derivation over other queries/signals |
| Signal | `signal()` | Writable reactive value in the graph |
| Client document | `useClientDocument`-backing query | Built on db query + LWW client-only events |

## Multi-Store

`StoreRegistry` (`src/store/StoreRegistry.ts`) manages concurrent stores with
reference counting; framework integrations acquire/release through it
(LS.SYS.STORE-R06). Context: RFC 0001 (multi-store API design) — a fold-in
candidate per decision 0002.

## Open Design Questions

- **LS.SYS.STORE-DQ1 Commit receipt.** Whether the commit-receipt proposal
  lands as specified (two-stage awaitables) or folds into a broader command
  design (LS-DQ1).
