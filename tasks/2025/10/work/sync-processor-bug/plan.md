# Implementation Plan

1. **Add Regression Test**
   - Update `tests/package-common/src/leader-thread/LeaderSyncProcessor.test.ts` with a new case that queues a local push during an ongoing upstream pull.
   - Use `waitForProcessing: true` and a short timeout to verify the waiter fails with `LeaderAheadError` instead of hanging.
   - Capture pull notifications to ensure no stray advance payload sneaks through.

2. **Reproduce Failure**
   - Run the new Vitest case to confirm it times out on current implementation, documenting the failure output in `problem.md`.

3. **Implement Fix**
   - Modify `backgroundApplyLocalPushes` in `LeaderSyncProcessor` to detect when all items were filtered out as old-generation.
   - Reject their deferreds with `LeaderAheadError` (minimum expected = current local head) and optionally emit a tracing event for observability before reopening the pull latch.
   - Ensure we also reject mixed batches correctly by handling filtered-out items separately.

4. **Verify Tests**
   - Re-run the targeted Vitest file to ensure the regression case now passes.
   - Run existing sync-related test suites if time permits to guard against regressions.

5. **Documentation & PR**
   - Summarize findings, alternatives, and chosen fix for the final response and PR message.

## Solution Options Considered
1. **Fail dropped deferreds (implemented)**
   - Pros: minimal change, aligns with expected contract that waiter receives `LeaderAheadError`, preserves existing queue semantics.
   - Cons: requires touching hot path; must ensure we still reopen pull latch and avoid double-failing deferreds.
2. **Re-enqueue dropped items with updated generation**
   - Pros: would automatically retry without notifying client.
   - Cons: masks underlying mismatch, risks infinite rebasing loops, and contradicts design where client must rebase locally.
3. **Introduce explicit rebase payload from leader**
   - Pros: provides richer guidance to client sessions.
   - Cons: larger change touching client pull logic, requires new protocol message, overkill for current regression.

Chose option 1 because it directly addresses the stalled deferred, keeps protocol semantics unchanged, and requires the smallest surface area change while unblocking both unit and end-to-end scenarios.
