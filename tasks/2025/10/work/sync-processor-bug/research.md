# Research Notes

## Context
- Investigating sync processor stall described in upstream PR #742.
- Focus on interaction between `ClientSessionSyncProcessor` and `LeaderSyncProcessor` when leader rejects local pushes after a rebase.
- Reviewed existing unit/integration tests under `tests/package-common` and runtime code in `packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts` and `packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts`.

## Key Findings
- `ClientSessionSyncProcessor` enqueues pushes via `leaderPushQueue` and waits for the leader to process them when `waitForProcessing` is true.
- `LeaderSyncProcessor.backgroundApplyLocalPushes` filters queued pushes by comparing each event's `seqNum.rebaseGeneration` with the current generation (`currentRebaseGeneration`).
- When all queued items are older generation, the code clears them but simply `continue`s without resolving associated deferreds.
- Deferreds are only resolved on successful advance or when the merge yields `_tag === 'reject'` (where new generation is computed). Old-generation drops therefore leak unresolved deferreds -> callers awaiting completion hang.
- Upstream PR patch also adds a Playwright repro and additional unit test; we can adapt the unit test for reproducibility in our environment.

## Evidence
- Running `pnpm vitest run src/leader-thread/LeaderSyncProcessor.test.ts` currently passes, indicating missing regression coverage.
- The patch file `/tmp/pr742.patch` shows a new test `local push old-gen items fail promptly with LeaderAheadError` that should fail on current code.
- The bug likely manifests when upstream pull increments `rebaseGeneration` while a local push is still pending.
