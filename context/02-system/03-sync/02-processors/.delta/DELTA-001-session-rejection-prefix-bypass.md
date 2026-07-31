# DELTA-001 — Session rejection permits a later event to bypass its pending prefix

Status: open

## Divergence

LS.SYS.SYNC.PROC-R04 requires an unresolved upstream prefix to fence later
pending events. `ClientSessionSyncProcessor` instead records
`LeaderAheadError`, clears `leaderPushQueue`, and continues the push-worker
loop. A commit admitted before pull reconciliation appends to the live pending
suffix and queues only its newly encoded event. The worker can therefore send
that later event while the rejected prefix remains pending
(`packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts:157-168,
446-457`).

The leader's admission checks require a monotonically ascending batch whose
first sequence number is ahead of `pushHeadRef`; they do not maintain a
per-session fence for a previously rejected generation. The later event can be
accepted and delivered first. The session then presents incoming `[B]` and
pending `[A, B]` to positional merge, which schedules `[B, A', B']` and
materializes `B` twice
(`packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts:1037-1066`).

Evidence: contrib Scenario System finding SF-03 (`many-writer-convergence`),
the captured `many-writer-396` transition, and the deterministic core regression
`does not rematerialize a pending event accepted ahead of its pending prefix`
(`tests/package-common/src/client-session/ClientSessionSyncProcessor.test.ts:176`).

## VRS

Violates [requirements.md](../requirements.md) LS.SYS.SYNC.PROC-R04 and the
prefix-confirmation precondition in
[syncstate/spec.md](../../01-syncstate/spec.md#prefix-confirmation-precondition).

## Implementation Contract

On rejection or an uncertain in-flight outcome, fence the affected boundary:
continue admitting local commits into pending, but do not send later events.
Pull reconciliation must first confirm the accepted prefix or rebase the full
remaining suffix, atomically reseed the push FIFO from current pending, and only
then resume its single worker. Add a receiver-side session/generation fence and
whole-batch admission checks as defense in depth; do not block the synchronous
commit path.

Close when deterministic tests prove that a later commit cannot reach the
leader before the rejected prefix is reconciled, the SF-03 regression passes,
and the equivalent leader→backend fence remains covered.
