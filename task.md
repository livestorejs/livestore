Title: Fix stalled push fiber on empty pull chunk + targeted regression test

Context
- Intermittent timeouts observed in integration tests (node-sync prop tests). Root cause is a deadlock in the LeaderSyncProcessor when:
  1) backend push fails (e.g., transient InvalidPushError/ServerAheadError) causing the push fiber to park (Effect.never), and
  2) the next backend pull yields an empty batch, which previously did not trigger a restart of the pushing fiber.
- This leaves pending local events unpushed, stalling the system until timeout.

Changes
1) packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
   - In onNewPullChunk, when newEvents.length === 0:
     - If there are pending non-client events, call restartBackendPushing(pending) to re-seed and re-run the pushing fiber.
     - Re-open localPushesLatch to avoid starving local push processing during empty pulls.

2) tests/package-common/src/mock-sync-backend.ts
   - Add initial empty pull emission to simulate a live pull wake-up.
   - Add failNextPushes(N[, error]) to deterministically simulate transient push failures in tests.

3) tests/package-common/src/leader-thread/LeaderSyncProcessor.test.ts
   - Add regression test "restarts backend pushing on empty pull after push error".
     - Fails without the fix (times out waiting for push to resume).
     - Passes with the fix (push resumes after empty pull emission).

How to run (locally)
- From this worktree:
  - direnv allow
  - mono test unit (or use vitest as configured in the repo)
  - To run just the targeted test: vitest run tests/package-common/src/leader-thread/LeaderSyncProcessor.test.ts --testNamePattern "restarts backend pushing on empty pull after push error"

Notes
- The test mock has an initial empty emission to reliably hit the fixed branch. If needed, this can be made configurable.
- The integration suite should also become more stable, but this PR keeps scope minimal and focused on the root cause.

PR
- Branch: fix/restart-push-on-empty-pull
- Open PR: https://github.com/livestorejs/livestore/pull/new/fix/restart-push-on-empty-pull

