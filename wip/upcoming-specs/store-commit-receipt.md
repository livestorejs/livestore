# Store Commit Receipt Awaitables

## Overview

Redesign `store.commit` to return a structured receipt that exposes awaitables for both leader-thread processing and upstream sync backend confirmation while keeping the commit call itself synchronous for local materialisation. This work is motivated in part by [livestorejs/livestore#285](https://github.com/livestorejs/livestore/issues/285).

## Public API

- `store.commit(...events)` now returns `StoreCommitReceipt` instead of `void`.
- Callers that previously ignored the result can continue doing so without behavioural changes, while new consumers can `await` the confirmation handles.

## `StoreCommitReceipt`

```ts
interface StoreCommitReceipt {
  leaderSync: SyncStage
  backendSync: SyncStage
}

interface SyncStage {
  /** Resolves when the stage succeeds, rejects with existing sync errors otherwise. */
  confirmation: Promise<void>
}
```

- Two distinct stages mirror our pipeline:
  - `leaderSync.confirmation` waits for the leader thread to materialise the batch and persist to the eventlog.
  - `backendSync.confirmation` waits for the leader to forward the batch to the configured sync backend.
- Promises are reusable (multiple `await`s resolve to the same outcome) and never reject purely because connectivity drops temporarily; they remain pending until the pipeline either succeeds or surfaces a terminal failure.

## Error Semantics

- No new error types; re-use the existing tagged errors already exposed by the sync stack:
  - `InvalidPushError` (including nested `LeaderAheadError`, `ServerAheadError`, `BackendIdMismatchError`).
  - `IsOfflineError` when the push loop gives up permanently or the platform signals an unrecoverable offline condition.
  - `UnknownError` for defects.
- `leaderSync.confirmation` unwraps `LeaderAheadError` via the existing mapping to `InvalidPushError`.
- `backendSync.confirmation` resolves only after a successful `syncBackend.push` and otherwise stays pending while the backend is offline; permanent failures reject via the errors above.

## Execution Flow Adjustments

1. **Store.commit**
   - Collect events synchronously as today.
   - Create two `Deferred` instances and package them into the receipt.
   - Pass the deferred handles along the push pipeline and return the receipt.
2. **ClientSessionSyncProcessor.push**
   - Accept an optional `SyncStageDeferreds` payload (`leader` + `backend`).
   - Attach `leaderDeferred` to each local push queue item so it resolves when the leader finishes local processing.
3. **LeaderSyncProcessor**
   - Extend `LocalPushQueueItem` to carry both deferreds.
   - `materializeEventsBatch` resolves leader deferreds after committing the SQLite transaction and rejects when the batch fails.
   - `backgroundBackendPushing` resolves backend deferreds after a successful backend push, rejecting with the propagated error otherwise. Deferreds persist across retries, so the promise fulfils once even after backoff cycles.

## Implementation Notes (TBD)

Concrete wiring across the client/leader boundary is still being explored. Current options:

- **Option 1 – RPC-based backend waiter (preferred for now):** expose `awaitBackendConfirmation` on `ClientSessionLeaderThreadProxy` that waits until the leader’s `syncState.pending` no longer contains the batch. Resolved via effect that the client can await to fulfil `backendSync.confirmation`.
- **Option 2 – Piggyback on upstream pull stream:** extend the existing pull payload with confirmation metadata and resolve pending receipts when the client receives matching sequence numbers.
- **Option 3 – Explicit commit handles:** generate client commit identifiers, have the leader echo them once backend push completes.

We currently lean towards option 1 because it requires the least protocol surface area while reusing the leader’s authoritative sync state. Final decision remains open until implementation begins.

## Backwards Compatibility

- Breaking change: `store.commit` now returns a receipt object. Update docs/examples accordingly.

