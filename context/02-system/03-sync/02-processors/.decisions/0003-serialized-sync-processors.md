# 0003 — Serialize each sync processor behind one owner

Status: accepted (2026-10-07, RFC 0004 accepted and folded in). Evidence: the
browser harness in
[RFC 0004 § Performance](../../../../../contributor-docs/rfcs/0004-serialized-sync-processors.md#performance)
and the deterministic suites
`tests/package-common/src/client-session/ClientSessionSyncProcessor.test.ts`
and `ClientSessionReconciliation.test.ts`. Supersedes
[0001](./0001-prefix-fence-unresolved-upstream.md) and
[0002](./0002-explicit-leader-push-reservations.md).

## Context

Each processor's coordination state was spread across independent primitives.
The leader combined two STM queues, `localPushBackendPullMutex`, an admission
semaphore, explicit push reservations, `pushHeadRef`, rebase-generation
filtering, restartable workers, and one `Deferred` per event. The session
combined `leaderPushQueue`, a pull-reconciliation mutex, rejection and
terminal-cause flags, and a push worker parked on `Effect.never` as its
rejection fence. No single value described a processor's state, so fixes added
one more flag, lock, or restart rule. That produced recurring failure classes:
lock lifetimes outliving their purpose (#1029), rebase-generation bookkeeping
(#710, decision 0002, DELTA-001), half-alive workers (#1133), shutdown loss
(#1405, #1437, #1465), and session in-memory state installed before its SQLite
rows were rolled back and rematerialized.

Constraints: `store.commit` stays synchronous and fatal on failure
(LS.SYS.STORE-R04, LS.SYS.STORE-R09); large pulls must not block input for the
whole batch; the sync provider contract (a live pull stream) stays unchanged;
no new state-machine framework or dependency in this code.

## Decision

Each processor gets **one owner** that is the only code allowed to change its
model. State changes are named, tagged messages; concurrent operations carry
identities so late results are ignored.

- **Leader:** a serialized mailbox of `LeaderMessage`s handled one at a time.
  Only waiting (backend pull, backend push, retry timers) runs outside a turn.
  Durable work moves behind `LeaderPersistence`; publication and
  acknowledgement follow a successful persist receipt.
- **Session:** a synchronous owner. `commit`, pull steps, and
  `SessionMessage`s run inside it; a runner does all waiting through jobs.
  Jobs and notifications go through an outbox delivered after release. Pulls
  apply in coherent 32-event steps, each in one savepoint against live pending
  events.
- The prefix fence of 0001 (LS.SYS.SYNC.PROC-R04) is kept as explicit states:
  `awaiting-pull` at leader→backend, `awaiting-reconciliation` at
  session→leader, plus leader validation against the tail of admitted history.
- The leader's dev-only materializer-hash check moves to the session, which
  compares its hash per pending event with the leader's on confirmation.

The contract lives in [../spec.md](../spec.md).

## Alternatives Considered

| Alternative                                               | Why it was not chosen                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep patching the mutex/queue design                      | Each failure class was fixed locally, but the state stayed implicit. The durable-head window has no local fix that keeps commits synchronous.                                     |
| Session mailbox plus a separate synchronous commit path   | Two writers. Without coherent steps it reproduces the durable-head race. With them it is as safe and as fast, but harder to audit, and push results wait for whole mailbox turns. |
| Whole-batch synchronous session owner                     | One writer, but input waits for the entire pull (up to ~500 ms on 1,000 events).                                                                                                  |
| Run each owner body on its own synchronous fiber          | Detects suspension earlier, but measurably slowed large commits. A microtask check detects suspension instead.                                                                    |
| Statechart framework (Effect Machine) for both processors | Adds a dependency, a vocabulary, nested specifications and duplicated schemas to critical synchronization code.                                                                   |
| Pure reducer plus command interpreter                     | Represents every effect twice and separates each durable operation from the invariant it completes.                                                                               |
| Fully serial leader thread                                | Requires a polling provider contract, blocks on every push, freezes offline, and cannot recover from `ServerAheadError`.                                                          |
| Guard pull steps by rebase generation                     | Head ordering deliberately ignores the local rebase generation, so this guard would invent a monotonicity contract the protocol lacks.                                            |

## Evidence

The change is motivated by correctness and readability, not speed. A browser
harness used the real Store, browser SQLite, journal, and subscriptions with a
controlled leader transport: 13 workloads (idle; 100 or 1,000 incoming events;
advance, rebase, and rebase with push cancellation), five alternating measured
pairs each after a warmup, Chromium 147 on an Apple M1 Pro, with a real
`store.commit` during reconciliation.

- **Chosen owner vs. a fixed split owner** (two writers, same coherent steps):
  both passed every correctness check in 130 samples; input ran during
  reconciliation in every non-idle sample. Medians were comparable: a
  1,000-event rebase (5 writes per event, 100 pending) had 60.2 ms vs 61.1 ms
  input delay and 2,049 ms vs 2,061 ms catch-up; a 100-event advance had
  8.2 ms vs 7.8 ms input delay.
- **Earlier run:** a whole-batch synchronous owner delayed input by up to
  497 ms on the same 1,000-event rebase, against 15.7 ms for a split owner; that
  split owner failed the durable-head check in 60 of 60 non-idle samples.
- **Against `main` (2026-10-08):** the livestore-contrib scenario benchmark ran
  `main` and this stack in alternating pairs, 10 samples each, on the 426-event
  two-writer and 400-event pending-tail scenarios. The first measurement was
  1.50 s vs 2.53 s (+69%) for two writers in one process. Profiling found
  overhead, not more sync work: savepoint statements evicting the session's
  statement cache, per-event service construction, re-validating every pending
  event on each merge, and replaying pending events once per 32-event step.
  After those fixes, medians were within 3% of `main` for two writers in one
  process or in separate processes and 17% slower in the browser, where
  `main`'s samples varied widely and 2 of 10 failed. The pending tail was 17%
  slower in one process, 8% slower in separate processes and 11% faster in the
  browser. All stack samples passed. The
  remaining commit cost is the session's per-event journal record (see the
  journal follow-ups in `../../../02-state/01-sqlite/spec.md`).
- **Not measured:** OPFS, workers, multiple tabs, the network, and tail
  latency. Replaying a large pending suffix in a step remains a long task
  (maximum frame gaps of about 68 ms).

## Consequences

- Public API unchanged. Leader acknowledgements keep their meaning (durable,
  published, scheduled; not backend-accepted).
- Subscribers may see complete intermediate prefixes of a large pull; if a
  later step fails, earlier prefixes stay applied and the session fails. A
  rollback refreshes all user tables.
- Internal APIs: the session's `encodeEvents`/`materializeEvents`/`push` become
  one `commit`; `LeaderSyncProcessor.pushPartial` is removed; the leader layer
  must provide `LeaderPersistence`. Events are plain values (no mutable
  `meta`); dev-only hashes travel in `PullItem.materializerHashes`.
- LS.SYS.SYNC.PROC-R01 is reworded to the `awaiting-pull` state; PROC-R02 to
  R04 keep their meaning.
- The leader still rejects pushes from an older rebase generation
  (`StaleRebaseGenerationError`) at admission and before a local turn; only the
  explicit reservation bookkeeping of 0002 is gone.
- Open follow-ups (from the RFC): incremental pending replay, leaving an
  unaffected in-flight backend push running, a one-off pull after
  `ServerAheadError` without live pull, typing the synchronous-materializer
  contract, and backpressure. See the spec's Known Gaps.
