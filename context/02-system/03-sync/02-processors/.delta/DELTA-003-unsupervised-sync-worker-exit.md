# DELTA-003 — Unknown failures retry forever or silently terminate sync workers

Status: open

This delta follows
[DELTA-002](./DELTA-002-server-ahead-passive-park.md), which owns active
`ServerAheadError` catch-up drift.

## Divergence

LS.SYS.SYNC-R03 and LS.SYS.SYNC.PROC-R01 classify `UnknownError` as an
unclassified terminal defect that must not be retried automatically.
`LeaderSyncProcessor` instead retries backend-push `UnknownError` indefinitely
alongside `IsOfflineError`.

LS.SYS.SYNC.PROC-R05 requires every background worker to retain lifecycle
ownership after a terminal failure. The shared ignore handler currently returns
`void`, so backend push, backend pull, or local-apply can complete permanently
while the Store continues. Its diagnostic is guarded by `LS_DEV`, making this
silent in production.

Code:
`packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts` (backend
push retry predicate and the boot-time `maybeShutdownOnError` handler).

## VRS

Violates [../requirements.md](../requirements.md)
LS.SYS.SYNC.PROC-R01 and LS.SYS.SYNC.PROC-R05, plus parent
[../../requirements.md](../../requirements.md) LS.SYS.SYNC-R03.

## Implementation Contract

Remove `UnknownError` from backend-push retry and retain only positively
identified connectivity failures. Route generic terminal causes from backend
push, backend pull, and local apply through one named supervision policy, after
any more-specific lifecycle-fatal policy. In ignore mode, emit an unconditional
error log and park rather than returning. Keep the failed operation's
acknowledgement/prefix unresolved so an existing protocol recovery path can
reconstruct work from current sync state without claiming that the terminal
attempt succeeded. Active `ServerAheadError` catch-up must be able to replace a
parked backend pull from the persisted cursor without weakening cooperative
pull retirement or the single-owner invariant.

Add deterministic tests that distinguish retryable recovery from terminal
parking, prove an `UnknownError` causes one push attempt rather than a retry
loop, cover terminal handling for all three worker roles under ignore mode, and
compose parked-pull supervision with active `ServerAheadError` replacement.
