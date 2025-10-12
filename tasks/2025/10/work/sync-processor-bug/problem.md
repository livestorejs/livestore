# Problem Statement

## Summary
Local pushes issued by the client session can stall indefinitely after the leader performs a rebase. When the leader increments the `rebaseGeneration`, any pending local pushes still queued with the older generation are silently dropped without notifying the waiting caller. Because the caller asked for `waitForProcessing`, the unresolved deferred causes the client session to hang with `pending > 0`.

## Expected Behaviour
- When the leader rejects or drops a queued local push because its sequence number no longer matches the current generation, the caller should be notified (e.g. with a `LeaderAheadError`) so it can rebase and retry.
- Pending events should not remain stuck; the waiter should resolve (success or failure) promptly.

## Actual Behaviour
- `backgroundApplyLocalPushes` filters out old-generation entries and simply continues, leaving the corresponding deferred unresolved.
- The client session waits forever for the push confirmation, so UI state shows `pending` events that never drain.

## Reproduction Plan
1. Extend `tests/package-common/src/leader-thread/LeaderSyncProcessor.test.ts` with a scenario where an upstream burst triggers a rebase while a local push waits with `waitForProcessing: true`.
2. The leader should drop the stale event; the test expects the waiter to receive a `LeaderAheadError` quickly.
3. On current code the effect times out instead, exposing the bug.

## Reproduction Evidence
- Added regression test `local push old-gen items fail promptly with LeaderAheadError` and ran it before the fix.
- The test timed out waiting for the leader push waiter (`poll` returned `None`), confirming the stall. See Vitest output showing the failure (`expected 'None' to be 'Some'`). 【c94bd1†L1-L12】
