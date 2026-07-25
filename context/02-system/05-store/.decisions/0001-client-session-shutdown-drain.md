# 0001 — Client-session shutdown drain: non-blocking serialization, flush-on-shutdown durability

Status: accepted (2026-07-19, maintainer-approved design resolution of the
#1465 review of #1451; supersedes the blocking-permit implementation on that
branch)

## Context

`Store.shutdown()` could report success after silently dropping client-session
events that were admitted to the caller but not yet accepted by the leader
(#1437): client commits become restart-replayable only once the leader writes
them to the eventlog, so tearing down the lifetime scope with events still
queued / a push in flight loses them. #1451 added an explicit processor drain
before lifetime-scope teardown — the right fix — but implemented the
push↔rebase serialization it needed with a **blocking** `rebaseOwnership`
`Semaphore` permit sitting on the `push` path.

The store's commit pipeline is spec'd **fully synchronous**, run via
`Effect.runSyncWith` (`store.ts:945`, LS.SYS.STORE-R09). A blocking permit on
`push` means a `store.commit()` landing while the pull fiber is parked mid-rebase
(holding the permit) suspends the commit effect → `runSyncWith` throws
`AsyncFiberError` out of `store.commit()`. The #1465 review verified this and
three further gaps (unbounded detached teardown; an untested no-loss invariant;
cross-fiber mutable `let`s). Standalone repro of the mechanism:
`schickling-repros/2026-07-effect-runsync-contended-semaphore`.

Three questions had to be settled before choosing an implementation.

## Options

- **Q1 — Must `store.commit()` stay fully synchronous?**
  - A. Yes, invariant (chosen). Forbids any blocking/suspension on the push
    path; constrains every future redesign.
  - B. Relax to allow an async commit. Rejected: breaks the React-suspense /
    `runSyncWith` contract and every synchronous caller.
- **Q2 — What is the durability contract?**
  - A. Flush-on-shutdown (chosen): a successful orderly `shutdown()` flushes
    every admitted client commit to the leader; a hard crash may still lose
    un-acked client commits. #1451 (so fixed) is therefore _done_, not a
    stopgap.
  - B. Persist-before-admit for client sessions (crash-durable client commits).
    The real disease-cure, but a separate, larger effort — deferred to
    LS.SYS.STORE-DQ1 / #1425, gated by the command/intent root LS-DQ1.
- **Q3 — How to serialize push↔rebase now?**
  - A. Minimal non-blocking fix (chosen): drop the blocking permit from `push`;
    have the rebase re-read/re-validate the live `syncStateRef.current.pending`
    and reconcile the push queue atomically after the async parks, so a push
    admitted during a park is folded in rather than torn away.
  - B. Structural actor/mailbox rewrite (single serialized owner-fiber
    consuming `LocalPush | PullChunk | Shutdown`; ordering intrinsic). The
    stronger long-term shape, matching the code's own "unify the processors"
    note — but larger and deferred.

## Decision

Q1 = A, Q2 = A, Q3 = A. The `push` path never blocks (invariant); orderly
shutdown flushes admitted client commits (documented contract), with
persist-before-admit as the separate future target; push↔rebase is serialized
by a **non-blocking atomic reconcile** rather than a permit. The actor rewrite
(Q3-B) is not built now.

Evidence: maintainer-approved resolution captured in the #1465 review thread
(design questions 1–4) and this branch's implementation + deterministic F1
oracle.

## Consequences

- `ClientSessionSyncProcessor.push` holds no permit. The rebase critical
  section rolls back, then in one `Effect.tx` clears the `leaderPushQueue` and
  re-offers the **live** `syncStateRef.current.pending` (not the stale
  merge-time snapshot) with no async park between read/clear/offer — atomic
  w.r.t. the synchronous `push`, which can only interleave in the pull fiber's
  async gaps. The permit is retained only on the pull tap ↔ `runShutdown` to
  serialize shutdown against rebase.
- The detached shutdown cleanup is hard-bounded
  (`SHUTDOWN_DRAIN_HARD_TIMEOUT_MS`, `create-store.ts`): after the bound the
  lifetime scope is force-closed, so an unresponsive leader cannot leak it
  (restores the intent of LS.SYS.STORE-R07). The 1s caller-side wait is
  unchanged.
- The no-loss invariant is now covered by a deterministic barrier test
  (`rebaseBarriers` hooks; replaces the flaky virtual-time `simSleep`
  harness): a push admitted at the rebase discard window survives, and the test
  fails if the reconcile reverts to the stale snapshot.
- Spec updates: LS.SYS.STORE-R09 commit-synchronicity restated as an explicit
  invariant; the store durability contract states flush-on-shutdown;
  LS.SYS.STORE-DQ1 annotated with persist-before-admit as the future target;
  LS.SYS.SYNC.PROC-R03 aligned with the non-blocking design.
- Not addressed (tracked as follow-ups): the actor/mailbox rewrite (Q3-B);
  persist-before-admit (Q2-B, #1425); the cross-fiber mutable `let`s
  (`shutdownStarted`, `terminalPushCause`, `unresolvedRejection`) noted in
  #1465 remain raw `let`s.
