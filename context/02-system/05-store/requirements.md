# Store — Requirements

The app-facing surface of LiveStore: the Store object, its commit path, and
the reactivity system that keeps queries live. Refines the unified-layer,
synchronous-read, and reactivity requirements of the root ([LS-R01],
[LS-R02], [LS-R12], [LS-R14]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). Event
semantics: `../01-event-model/`; state semantics: `../02-state/`; runtime
topology: `../04-runtime/`. Framework bindings build on this node
(`../08-integrations/`).

## Requirements

- **LS.SYS.STORE-R01 Single entry point:** `refines: LS-R01` — One Store per
  `storeId` exposes querying, subscription, commit, event streaming, and
  lifecycle; apps need no other LiveStore surface.
- **LS.SYS.STORE-R02 Synchronous queries:** `refines: LS-R02, LS-R14` —
  `store.query` executes synchronously against the session state database;
  no promise, no loading state.
- **LS.SYS.STORE-R03 Reactive subscriptions:** `refines: LS-R12` —
  Subscriptions fire exactly when a query's result may have changed, driven
  by an incremental reactivity graph rather than re-running all queries.
- **LS.SYS.STORE-R04 Atomic local commits:** `refines: LS-R04` — A commit of
  one or more events materializes locally as one unit before the call
  returns; upstream propagation is asynchronous.
- **LS.SYS.STORE-R05 Composable query kinds:** Db queries, computed values,
  and signals compose into one reactive graph; client-document queries build
  on the same primitives.
- **LS.SYS.STORE-R06 Multi-store:** Multiple stores (different `storeId`s)
  run concurrently in one app through a store registry with reference-counted
  lifecycles.
- **LS.SYS.STORE-R07 Explicit lifecycle:** A store is shut down explicitly;
  integrations own automatic shutdown. Intentional shutdown is
  distinguishable from failure.
- **LS.SYS.STORE-R08 Typed results:** `refines: LS-R11` — Query results are
  schema-validated; the query builder and result schemas are fully typed.
