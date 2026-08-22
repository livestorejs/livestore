# DELTA-003 — Unknown failures retry forever or silently terminate sync workers

Status: resolved (2026-08-22)

Numbering note: DELTA-002 is reserved by the open ServerAhead intent PR #1575.

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
identified retryable errors. Route terminal causes from backend push, backend
pull, and local apply through one named supervision policy. In ignore mode,
emit an unconditional error log and park forever rather than returning. Keep
the failed operation's acknowledgement/prefix unresolved so an existing
protocol recovery path can reconstruct work from current sync state without
claiming that the terminal attempt succeeded.

Add deterministic tests that distinguish retryable recovery from terminal
parking, prove an `UnknownError` causes one push attempt rather than a retry
loop, and cover terminal handling for all three worker roles under ignore mode.

## Resolution

Backend push now retries only `IsOfflineError`; `UnknownError` reaches the
terminal supervision boundary after one attempt. Backend push, backend pull,
and local apply all use the named supervision policy. Ignore mode logs at error
level in every build and parks forever, while interrupt-only causes still end
normally during scope shutdown. A pull reconciliation can continue to clear
and replace a parked backend-push worker from current pending state.

Deterministic tests observe the supervision boundary for all three roles and
advance the test clock to prove the retry schedule distinguishes
`IsOfflineError` from `UnknownError`.
