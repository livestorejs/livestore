# Root Cause Analysis: Client Session → Leader Push Stall (LinearLite)

## Problem Summary

In the Web LinearLite app, changing data (e.g., updating an issue priority) sometimes leaves the LiveStore client session with non-empty `pending` events that never get pushed to the leader. The UI shows a permanent pending state; `__debugLiveStore.default._dev.syncStates()` reports `session.pending.length > 0` while the leader remains unchanged.

This occurs when the client session attempts to push a batch to the leader and the leader rejects with a `LeaderAheadError`. The current client session push loop clears its local push queue but does not recover by re-encoding/rebasing and retrying, leaving `pending` stuck unless an upstream pull later unblocks it. In setups without an upstream backend (common in examples), no pull arrives, so the stall persists.

## Affected Components

- Client session push path: `packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts`
- Leader validation path: `packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts` (`validatePushBatch` and `push`)
- Web LinearLite app runs frequently without a sync backend → no upstream advances to trigger recovery

## Minimal Reproduction (Browser)

1. Open LinearLite without a sync backend (no `VITE_LIVESTORE_SYNC_URL`).
2. Change priority of an issue.
3. If a leader-side validation rejects the push (rare race/ordering), `session.pending` remains non-empty and never drains; the leader does not change.

Playwright repro: `tests/integration/src/tests/playwright/linearlite-sync.play.ts` performs a priority change and asserts that pending drains; it failed initially, confirming the problem.

## Minimal Reproduction (Node)

Two useful experiments:

- Forced LeaderAheadError: `tests/integration/src/tests/node-sync/repro-node-forced-leader-ahead.ts`
  - Injects a one-time `LeaderAheadError` for the first leader push.
  - Before fix: `session.pending` remains, leader unchanged. After fix: pending drains.

- ClientSession test suite regression: `tests/package-common/src/client-session/ClientSessionSyncProcessor.test.ts`
  - Test: “retries leader push after LeaderAheadError (queue must not stall)” injects a single `LeaderAheadError` in the first leader push.
  - Current behavior (queue clear only): test fails (timeout / single push call).
  - With proposed fix: test passes (retry succeeds, pending drains).

## Sequence Analysis

Below is a step-by-step for the problematic path when the leader rejects the client session’s local push:

1. User triggers a local change (e.g., priority update).
2. `Store.commit(...)` → `ClientSessionSyncProcessor.push(batch)`
   - Encodes events with next local sequence numbers (e.g., from `e0` to `e1`).
   - `SyncState.merge({ _tag: 'local-push' })` returns `_tag: 'advance'` and appends new events to `syncState.pending`.
   - Materializes locally; sets `sessionChangeset` on encoded events.
   - Enqueues encoded events to `leaderPushQueue`.
3. Background pusher: `BucketQueue.takeBetween(leaderPushQueue, 1, batchSize)` → `leaderThread.events.push(batch)`.
4. Leader validates batch in `LeaderSyncProcessor`:
   - If leader’s push head is ahead (or batch is not strictly increasing relative to current push head), `validatePushBatch` returns `LeaderAheadError`.
5. Client session catches `LeaderAheadError` in `ClientSessionSyncProcessor`:
   - Current behavior: increments `rejectCount` and calls `BucketQueue.clear(leaderPushQueue)`.
   - Importantly, it does not re-encode/rebase `syncState.pending` on the leader’s head, nor re-queue them.
6. Background pusher now has no queued items. `syncState.pending` remains unchanged; leader does not receive further pushes.
7. Without an upstream backend producing pull payloads (common in the demo), no downstream merge/rebase occurs to “unstick” the state. UI remains pending.

Key observation: The client session must either (a) rely on an upstream pull carrying a rebase/advance to rewrite pending, or (b) actively perform a local re-encode/rebase and re-queue on push rejection. In no-backend mode, (a) never happens.

## Root Cause

On leader push rejection (`LeaderAheadError`) the client session push loop only clears the queue. It does not:

- Fetch the leader’s head,
- Re-encode current `syncState.pending` onto that head,
- Locally rebase (rolling back previous materializations using stored `sessionChangeset`),
- Update local sync state,
- Re-queue the re-encoded pending for another push.

This omission leaves the session in a state where pending is non-empty and no further pushes are attempted, relying solely on an upstream pull that may never occur.

## Proposed Fix (Validated Locally)

On `LeaderAheadError` inside the client session’s background pusher:

1. Clear `leaderPushQueue` (drop stale encodings).
2. Fetch leader sync state: `leaderSyncState = clientSession.leaderThread.getSyncState`.
3. If `syncState.pending` is non-empty:
   - Re-encode pending events on top of `leaderSyncState.localHead` using `EventSequenceNumber.nextPair`.
   - Perform a local `SyncState.PayloadUpstreamRebase` merge with `rollbackEvents = old pending` and `newEvents = re-encoded`.
   - Roll back previous local materializations by applying stored `sessionChangeset` in reverse order and marking them unset.
   - Update `syncStateRef.current` and notify `syncStateUpdateQueue`.
   - Offer new pending back to `leaderPushQueue` and restart the pushing fiber.

Effects:

- Unblocks the client session without relying on external upstream pulls.
- Tested via:
  - Node forced repro: pending drains and leader advances.
  - Browser Playwright repro: priority change drains pending.
  - New regression test in `tests/package-common/...`: passes with the fix.

## Why the Leader Can Be Ahead

- Multiple client sessions for the same client (rare but possible),
- Race conditions during boot or concurrent pushes,
- Validation enforcing strictly increasing sequence numbers relative to the leader’s push head.

In these situations, first push attempt might be rejected, requiring rebasing of `pending` to a new parent head.

## Notes & Trade-offs

- The recovery path effectively performs the same logical operation as an upstream-driven rebase, but locally. It uses the stored `sessionChangeset` to roll back materializations safely before re-materializing.
- The recovery introduces extra work when LeaderAheadError happens; however, this path is rare and bounded.
- The behavior is coherent with the invariant that the leader’s push head must not regress.

## Next Steps

1. Land the local recovery fix in `ClientSessionSyncProcessor` (currently commented out per request).
2. Keep the regression test:
   - `tests/package-common/src/client-session/ClientSessionSyncProcessor.test.ts` → “retries leader push after LeaderAheadError (queue must not stall)”.
3. Consider documenting expected behavior of the client session in no-backend mode.

