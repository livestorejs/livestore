# Sync Processors — Spec

This document specifies the leader- and session-side sync processors that
drive the [syncstate merge core](../01-syncstate/spec.md). It builds on
[requirements.md](./requirements.md). The design was accepted as
[RFC 0004](../../../../contributor-docs/rfcs/0004-serialized-sync-processors.md);
the choice and its rejected alternatives are recorded in
[.decisions/0003-serialized-sync-processors.md](./.decisions/0003-serialized-sync-processors.md).

## Status

Draft.

## Scope

Defines: each processor's owner and model, admission, batching, retry,
precedence, cursor/head tracking, cancellation, the durable seam between the
leader processor and SQLite, and shutdown. Does not define: merge semantics
(`../01-syncstate/`), materializer and journal mechanics
(`../../02-state/01-sqlite/`), or processor placement (`../../04-runtime/`).

## Shared Shape

Both processors are either synced with their upstream or hold pending events
that upstream has not confirmed. The session's upstream is the leader thread;
the leader thread's upstream is the sync backend. Each processor has **one
owner**: the only code allowed to change its model. Everything that can change
the model is a named, tagged message (`LeaderMessage`, `SessionMessage`), and
every concurrent operation carries an identity (operation, retry, pull, or
reconciliation id) so a late result from superseded work is ignored instead of
advancing newer work.

```text
Store.commit ─► ClientSessionSyncProcessor
                  ├─ synchronous owner: local commits, pull steps, push results
                  └─ runner: leader push, cancellation, refresh, yield, shutdown
                         │ leaderThread.events.push / pull
                         ▼
                LeaderSyncProcessor
                  ├─ mailbox: one message at a time, one explicit model
                  ├─ publication to sessions, acknowledgements
                  └─ backend pull, push and retry fibers ──► sync backend
                         │
                         ▼
                LeaderPersistence ──► state DB + eventlog DB
```

| Module                       | Owns                                                                                                 | Does not own                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ClientSessionSyncProcessor` | optimistic session state, leader propagation, stepped reconciliation, session shutdown               | Store's subscriber refresh after commit, leader durability |
| `LeaderSyncProcessor`        | ordering, in-memory sync state, publication, acknowledgements, backend pull/push, retries, lifecycle | SQLite transition details                                  |
| `LeaderPersistence`          | rollback, materialization, journal maintenance, eventlog writes, heads, coordinated SQLite commits   | queues, publication, retries, acknowledgements, lifecycle  |

## Leader Sync Processor

`leader-thread/LeaderSyncProcessor.ts` (`:53-62`).

### Mailbox and model

One loop (`run`, `:621-634`) takes a `LeaderMessage` from an unbounded mailbox
(`:123`) and handles it completely before taking the next (`handleMessage`,
`:471-619`). `model` is a local variable rather than a `Ref`; only the loop
changes it, apart from boot and operation startup in the same scope
(`:148-150`). `LeaderMessage` is a closed union of 11 tags (`:742-757`):
`LocalPushRequested`, `UpstreamBatchReceived`, `PullCompleted`, `PullFailed`,
`PullRetryElapsed`, `PushSucceeded`, `PushFailed`, `PushRetryElapsed`,
`ContinueWork`, `LocalWorkEnabled` (test-delay release only) and
`ShutdownRequested`.

```text
lifecycle:  starting ─► running ─► stopping
                           └─────► failed
pull:       disabled | streaming { pullId, pagination: between-pages | more-expected, attempt }
            | retry-wait { retryId, attempt } | completed
push:       disabled | idle { queued } | in-flight { operationId, attempt, batch, queued }
            | retry-wait { retryId, attempt, batch, queued } | awaiting-pull { queued }
plus:       syncState, localQueue, upstreamQueue, localWorkEnabled, nextOperationId
```

(`:759-800`.) Operation, pull, and retry ids come from one counter
(`allocateOperationId`, `:154-159`).

### Admission

`push` (`:636-662`) registers one request-level acknowledgement with a
remaining-event count before waiting for boot, so shutdown can interrupt every
admitted caller (`:641-653`), then sends `LocalPushRequested`. The handler
(`:482-503`) validates the batch against the tail of `localQueue`, or the
local head when the queue is empty, so it checks committed plus admitted
history, then appends it to `localQueue`. `validatePushBatch` (`:942-1017`)
requires a strictly ascending batch (`NonMonotonicBatchError`), a first event
ahead of that head (`LeaderAheadError`), a first event no older than the head's
rebase generation (`StaleRebaseGenerationError`), and an exact sequence/parent
chain from the head (`NonContiguousBatchError`). Parent continuity compares
global/client position only (`isSameSequencePosition`,
`LeaderPersistence.ts:175-182`): a confirmed leader head and a rebased session
head can name the same position with different local generations. This chain
check is the receiver-side prefix fence of LS.SYS.SYNC.PROC-R04.

A `ContinueWork` turn selects up to `localPushBatchSize` admitted items
(default 10, `:140`). Items whose generation is older than the current local
head's are rejected with `StaleRebaseGenerationError` (`:410-429`). If merge
rejects the batch, the turn fails its acknowledgements with `LeaderAheadError`
together with every queued item of the same rebase generation, because those
were numbered on top of the rejected batch; the session rebases and re-pushes
(`:277-304`). A local push that merge would rebase is a defect (`:305`).

### Precedence

A `ContinueWork` turn always applies queued upstream pages before local work
(`:395-401`). While the current page reports `more-expected`, local work waits
until the paginated advance is complete (`:402-404`, LS.SYS.SYNC.PROC-R02).

### Durability inside the turn

`processLocalBatch` (`:267-337`) and `processUpstreamBatch` (`:339-390`) merge,
then await `LeaderPersistence`. Only after a successful receipt does the turn
publish (update `syncState`, its `SubscriptionRef`, and every session pull
queue; `:251-265`), update the backend push plan, and resolve acknowledgements
or release the provider page. Nothing can observe a half-applied transition.
The processor checks each receipt against the merge: a local receipt's state
head must equal the new local head exactly (`:316-322`); an upstream receipt is
compared by global/client position and backend head (`:367-379`), because the
backend does not preserve the leader's local rebase generation — a pending
event the leader rebased (`e1` → `e2`, generation 1) is confirmed as `e2`. A
mismatch stops the processor as a sync failure.

A push acknowledgement therefore means durable, published, and scheduled for
the backend — not backend-accepted (`:74`).

### Backend push and retry

At most one provider push runs (`pushHandle`). `startProviderPush` takes up to
`backendPushBatchSize` events (default 50, `:141`) from `push.queued` and
records `in-flight { operationId }` before forking the call (`:195-216`). The
fiber waits for the backend to be connected and for the devtools latch, then
pushes `toGlobal()` events (`:835-876`). Results come back as `PushSucceeded`
or `PushFailed` carrying the operation id; a stale id is ignored (`:567-609`).

- `ServerAheadError` moves the push to `awaiting-pull`, keeping batch and queue
  but never retrying the stale batch in place (`:578-589`, LS.SYS.SYNC.PROC-R01,
  PROC-R04). The next upstream page rebuilds the plan.
- `BackendIdMismatchError` applies `onBackendIdMismatch` (`:433-469`): `ignore`
  disables pushing (or completes pulling), `shutdown` stops the leader, and
  `reset` interrupts all work, clears both databases (`:1234-1254`), and stops.
- Any other failure (`IsOfflineError`, `UnknownError`, including a defect
  wrapped as `UnknownError`, `:868-874`) moves the push to `retry-wait` with
  capped exponential backoff: `min(30s, 1s · 2^(attempt-1))`, no jitter, no
  attempt cap (`:592-609`, `:1257`). `PushRetryElapsed` with the current
  `retryId` re-runs the same batch (`:610-615`).

Each upstream page rebuilds the push plan from committed non-client-only
pending events (`replacePushPlan`, `:240-249`, called at `:387`): any push
state becomes `idle` with the new queue, and an in-flight push is interrupted;
that interruption is awaited inside the turn.

### Backend pull

At most one provider pull runs (`pullHandle`, `:218-238`). Its cursor is
`Eventlog.getSyncBackendCursorInfoForDb` for the current upstream head — the
persisted backend head plus provider-opaque sync metadata (`:902`). Each page
becomes one `UpstreamBatchReceived` with its pull id; the stream then waits
until the turn durably commits or deliberately discards that page before it
delivers the next, so later pages cannot race ahead of the persisted cursor
(`:904-924`). A page from a superseded pull is released without changing the
model (`:511-516`). Pages merge with `ignoreClientOnlyEvents: true`
(`:341-347`). `IsOfflineError` moves the pull to `retry-wait` with the same
backoff (`:544-554`); other failures stop the leader when `onError: 'shutdown'`,
otherwise the pull is marked `completed` (`:557-561`). The stream end sends
`PullCompleted` (`:938`).

### What waits concurrently, and why

The leader makes every decision one message at a time; only waiting happens
outside a turn. Three kinds of waiting could otherwise block the mailbox
indefinitely:

- **Backend pull** (at most one): a live stream that can sit idle for hours.
  Pages stay serial through the per-page completion handshake above.
- **Backend push** (at most one): a round trip that can hang or fail
  repeatedly while offline. Awaiting it inside a turn would stop local pushes
  from becoming durable and stop shutdown from proceeding.
- **Retry timers**: backoff sleeps in `backgroundFibers` (`:153`). Each
  completion carries its `retryId`, so superseded timers are ignored.

A fully serial leader would need a polling sync-provider contract, would block
on every push round trip, would freeze while offline, and could never recover
from `ServerAheadError`, because recovery needs a pull. The cost of concurrent
waiting is visible in the model: operation identities, the `awaiting-pull`
state, and interruption.

### Boot

`boot` (`:664-691`) runs once: it forks the loop, sets `running`, and starts
the provider pull and push. The initial sync state is rehydrated from the
eventlog by the leader layer (`getInitialSyncState`,
`make-leader-thread-layer.ts:288-326`; see `../../04-runtime/spec.md`
Leadership Handover), and the initial push plan is its non-client-only pending
suffix (`:811-828`).

### Failure and shutdown

- `ShutdownRequested`, sent by the boot scope's finalizer (`:684-689`), stops
  the processor as `stopping`: it interrupts the provider pull and push, retry
  timers, every registered acknowledgement (closing the registry so later
  `push` calls are interrupted at admission), and every waiting provider page
  (`stop` and `interruptAllWork`, `:161-190`). Admitted but unprocessed local
  pushes are interrupted, not drained.
- A message that arrives once the lifecycle is no longer `running` changes
  nothing; a late `LocalPushRequested` is interrupted (`:476-479`).
- A merge failure, persist failure, or receipt mismatch is a sync failure
  (`stopForSyncFailure`, `:192-193`): the processor stops as `failed` and
  notifies the shutdown channel only when `onError: 'shutdown'`.
- A defect in a handler stops the processor as `failed` and always notifies
  the shutdown channel (`:626-628`).

## LeaderPersistence: the Durable Seam

`leader-thread/LeaderPersistence.ts` (`:59-66`) has two methods,
`persistLocal` (`:90-110`) and `persistUpstream` (`:112-170`). Together they
perform rollback, materialization (which also writes eventlog rows), journal
maintenance, sync-metadata updates for confirmed events, state and backend
heads, and the coordinated commit. Events are plain values that
materialization does not mutate, so the processor's plan is persisted as is.
Each call returns a **persist receipt** (`LocalPersistReceipt`,
`UpstreamPersistReceipt`, `:35-49`) with the persisted events and their
materializer hashes, so the processor publishes exactly what was written.

`persistUpstream` rolls back the journal for `rollbackEvents`, resets the
state head to the first rolled-back event's parent, and deletes those eventlog
rows (`:118-127`); materializes the merged events with their pulled sync
metadata (`:129`); records metadata for confirmed events (`:131-141`);
discards journal entries up to the backend head (`:143-144`); and writes the
backend head in the same eventlog transaction as the event inserts
(`:146-147`).

Each call opens one transaction on the state DB and one on the eventlog DB and
commits state first, then the eventlog, inside an uninterruptible region with a
joint rollback finalizer (`withCoordinatedTransactions`, `:184-224`). This
protects against errors and interruption but is **not crash-atomic across the
two databases**: a process death between the two COMMITs can leave state ahead
of the eventlog (LS.SYS.STATE-DQ2; healed only by state rebuild, see
`../../02-state/01-sqlite/`).

## Client Session Sync Processor

`sync/ClientSessionSyncProcessor.ts` (`:50-56`). The session cannot use a
mailbox, because `store.commit` must return with its change applied and cannot
queue behind other work (LS.SYS.STORE-R04). Instead every state change runs
synchronously inside one owner, and all waiting moves out to a runner.

### Owner, outbox, runner

- **Owner** — `owned(body)` (`:155-189`), the only code that writes `model`.
  Exclusion relies on the body being synchronous; `PreventSchedulerYield`
  suppresses Effect's automatic yields (`:186`). A queued microtask detects a
  body that suspends anyway (for example an asynchronous materializer); the
  session then fails with a named defect (`failIfSuspended`, `:193-202`). A
  nested `owned` call from inside a body dies as reentrant (`:165-167`).
- **`SessionMessage`** — 11 tags entered through `dispatch` (`:191`,
  `:809-820`): `Started`, `PullReceived`, `PullFinished`, `PushCancelled`,
  `PushSucceeded`, `PushRejected`, `PushFailed`, `Failed`,
  `ShutdownRequested`, `DrainStarted`, `Stopped`; `transition` routes each to
  its workflow (`:106-145`). `commit` and a pull step also enter the owner but
  return results to their caller.
- **Job** — work for the runner (`RunnerJob`, `:821-833`): `Push`,
  `Reconcile`, `BeginShutdown`, `FinishShutdown`, `NotifyFailure`. The runner
  takes jobs one at a time from an unbounded queue (`:87`, `runJobs`,
  `:721-727`) and reports each outcome back as a message.
- **Notification** — a `syncState` update, pull completion, or shutdown result.
- **Outbox** — where the owner holds jobs and notifications (`addToOutbox`,
  `:204-208`). It is delivered after the owner is released and dropped if the
  body fails (`:173-183`). Completing a `Deferred` or offering to a `Queue`
  resumes the waiting fiber inline, in the caller's stack; delivering
  mid-change would let woken code observe half-finished state or re-enter the
  owner.
- **Savepoint** — a SQLite `SAVEPOINT` on the session's state database
  (`SqliteDbHelper.withSavepoint`). The journal and state head are tables in
  that same database, so one savepoint covers rows, journal, and head; the
  journal's per-event savepoints nest inside it.

The model (`:886-891`):

```text
lifecycle: starting ─► running { reconciliation? } ─► shutdown-requested { exit, reconciliation? } ─► stopping ─► stopped
           (any live state) ─► failed { cause, shutdownExit? } ─► stopped
push:      idle { queued } ─► in-flight { operationId, batch, queued }
           in-flight ─► idle (succeeded) | awaiting-reconciliation (rejected) | cancelling (rebase step)
           cancelling ─► idle (PushCancelled);  awaiting-reconciliation ─► idle (recovered by a pull)
```

At boot the in-memory sync state starts from the leader head the adapter
reports, with no pending events (`:92-98`); the runner and pull fiber are then
forked (`:765-775`). Nothing else writes the session database after boot. In
development, every owner release checks that the push queue is the unpushed
suffix of pending (`checkModelInvariants`, `:470-492`).

### Commit

`Store.commit` runs `processor.commit` (`:785-787`) synchronously via
`Effect.runSyncWith` (`store.ts:886`, `:927`). Inside the owner,
`commitLocalEvents` (`:212-251`) checks admission (lifecycle `running`, else a
defect), encodes events and assigns sequence numbers from the local head
(`:510-537`), merges them as `local-push`, and materializes the batch in one
savepoint (`:235-238`). Only after the savepoint is released does it assign the
in-memory sync state and append the new events to `push.queued` — unless the
push is `awaiting-reconciliation`, whose queue the next pull rebuilds
(`:239-247`). It then reserves a `Push` job if propagation is eligible
(`reserveNextPush`, `:368-385`). After release the outbox is delivered, and
Store refreshes the written tables (`store.ts:888-907`). No browser task runs
before `store.commit` returns; subscriber callbacks and resumed fibers may
commit again, entering the same path as a new commit.

### Pull: stepped reconciliation

The pull fiber (`:729-747`) streams from the leader at the current upstream
head (behind the devtools pull latch when enabled) and restarts the stream when
it ends. `PullReceived` (`acceptPull`, `:253-281`) validates the whole payload
by merging it, registers a reconciliation id, and queues a `Reconcile` job; the
stream waits for that job before it delivers the next item. A pull arriving
after admission closed completes without being applied (`:257-260`).

The runner applies the payload in steps of `PULL_CHUNK_SIZE` = 32 events
(`:892-893`); an explicit leader rebase's first step extends far enough to
reach the old upstream head (`minimumEnd`, `:267-272`). Each step
(`reconcile`, `:631-664`; `applyPullStep`, `:283-309`) runs in the owner:

1. Merge the incoming prefix against the **live** pending events, never against
   a plan from before the last yield.
2. In one savepoint, roll back the journal, materialize incoming events,
   replay pending events, and set the state head (`applyPullToSqlite`,
   `:555-602`).
3. Assign the in-memory sync state; a rebase also resets the push to
   `idle { queued: pending }`, invalidating the old operation. Release the
   owner and deliver the outbox.

The runner then refreshes the written tables — all user tables after a
rollback (`:580-585`) — and yields. A local commit can land between steps.
Only the last step discards the journal up to the payload's global head
(`:597`). `PullFinished` (`finishPull`, `:311-326`) clears the
reconciliation; if a step rebased or a rejected batch is now recovered (judged
against current state, not a snapshot from pull start), it rebuilds the push
queue from current pending. It then reserves the next push. No replacement
push starts while a reconciliation is active (`:370`).

### Cancellation

If a step needs a rebase while a leader push is in flight, the owner sets
`push: cancelling` and returns `cancel-push` without touching SQLite or sync
state (`:289-295`). The runner interrupts the push fiber outside the owner,
sends `PushCancelled`, and retries the same prefix from live state
(`:649-655`, `:328-333`). Commits during that wait apply against the previous
coherent state. A late success or rejection from the cancelled push is
ignored; a fatal failure still fails the session (`:340-348`).

### Push results

The owner records `in-flight { operationId }` before the `Push` job becomes
visible to the runner (`:377-384`). The runner starts at most one leader push
and skips a job that became obsolete while queued (`startLeaderPush`,
`:666-690`). `PushSucceeded`, `PushRejected`, and `PushFailed` carry the id
(`completePush`, `:335-366`). A rejection moves the push to
`awaiting-reconciliation` unless current pending events already show the batch
was recovered; later commits accumulate in pending without crossing the
boundary until a pull confirms or rebases the rejected prefix
(LS.SYS.SYNC.PROC-R04). `PushFailed` (a non-interrupt leader failure) fails the
session.

### Materializer hash check

In development, materializers' results are hashed on both sides. The session
records its hash for each pending event it materializes — on commit
(`materializeEvents`, `:539-553`) and when replaying pending events during a
pull step (`:593`) — in `pendingMaterializerHashes` (`:100-104`, `:496-499`).
The leader publishes the hashes from its persist receipts in
`PullItem.materializerHashes` (decoded as `[]` when absent). When an advance
confirms a pending event, the session compares its recorded hash with the
leader's and fails with `MaterializerHashMismatchError` on divergence
(`:562-574`). This catches a side-effecting or non-deterministic materializer
even though confirmed events are not re-materialized. Rolled-back events drop
their recorded hashes (`:575-578`). Incoming events are materialized with the
leader's hash, and the session materializer compares it with its own
(`store.ts:259-272`).

### Failure and shutdown

- Pull, reconciliation, and handler failures arrive as `Failed`
  (`reportFailure`, `:607-610`), which sets `lifecycle: failed` and queues
  `NotifyFailure`; the runner then stops pull and push and shuts down the Store
  (`:437-456`, `:710-715`). If even `Failed` cannot be recorded, the processor
  logs both causes and shuts down the Store directly (`:612-628`).
- **Orderly shutdown** (`shutdown(exit)`, `:779-784`) closes admission
  immediately (`shutdown-requested`, `:387-416`). The `BeginShutdown` job runs
  after any accepted `Reconcile` job, stops the pull fiber, and sends
  `DrainStarted` (`:701-704`). For a successful exit the processor enters
  `stopping` and drains the rebuilt pending suffix in batches until the queue
  is empty (`:418-435`, `:372-375`); an unresolved rejection or a fatal leader
  failure fails the drain instead of claiming durability (`:361-363`,
  `:441-444`; LS.SYS.SYNC.PROC-R03). A shutdown requested with a failure exit,
  or a failed session, never drains. `FinishShutdown` stops pull and push and
  completes the shutdown result (`:705-709`).
- The Store runs this cleanup detached under a **hard bound**: the caller stops
  waiting after 1s, and the detached drain is itself force-closed after
  `SHUTDOWN_DRAIN_HARD_TIMEOUT_MS` (`create-store.ts:53`, `:389-410`,
  `:560-571`) so an unresponsive leader cannot leak the lifetime scope
  (LS.SYS.STORE-R07). A successful close of the scope the Store was created in
  triggers the same drain.

### Observability and test hooks

`syncState.changes` streams a queue the owner offers to on every state change;
it is for debugging and observability only (`:88`, `:788-791`). With
`confirmUnsavedChanges`, a `beforeunload` handler warns while pending events
exist (`:749-763`). Deterministic `rebaseBarriers` pause the runner (never the
owner) at two labeled points around push cancellation and the end of a rebasing
pull (`:606`, `:651`, `:662`).

## Invariants

| Property                                                                          | Status                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| One owner changes each processor's model                                          | guaranteed (leader mailbox; session synchronous owner)         |
| Late completions cannot advance newer work                                        | guaranteed by operation, retry, pull and reconciliation ids    |
| Leader publication and acknowledgement follow a successful persist receipt        | guaranteed                                                     |
| Local leader pushes are validated against committed plus admitted history         | guaranteed                                                     |
| Upstream pagination takes precedence over new local durable work                  | guaranteed                                                     |
| A session commit is applied before `store.commit` returns                         | guaranteed                                                     |
| Session rows, journal, head and in-memory sync state agree at every owner release | guaranteed for synchronous materializers and SQLite services   |
| Code woken by a session transition sees only completed state                      | guaranteed (outbox delivered after release)                    |
| Session messages are processed in FIFO order                                      | **not required**; ordering comes from the owner and identities |
| A session pull payload is applied atomically                                      | **no**; complete prefixes may be visible                       |
| Store refreshes a commit's tables before code it resumes runs                     | **no**; resumed code can refresh or commit first               |
| A leader acknowledgement means backend acceptance                                 | **no**; it means durable, published, and scheduled             |
| State DB and eventlog DB are crash-atomic together                                | **no** (LS.SYS.STATE-DQ2)                                      |
| Hard frame-time bound during reconciliation                                       | **no**; a step bounds event count, not time                    |

The session's agreement between SQLite and in-memory state can break only when
the session is already failing (a failed rollback or a suspended owner body).
The types do not enforce it;
`tests/package-common/src/client-session/ClientSessionReconciliation.test.ts`
checks it.

## Backpressure and Known Gaps

- The leader mailbox, `localQueue`, `upstreamQueue`, and the session job queue
  are unbounded; there is no producer backpressure. Provider pull pages are the
  exception: one page at a time.
- Every reconciliation step replays the full pending suffix, so large rebases
  produce long tasks (about 2 s of catch-up and ~68 ms frame gaps in the RFC's
  largest browser workload).
- Every upstream page interrupts and rebuilds an in-flight backend push, even
  when the page does not touch the in-flight batch.
- With `livePull: false`, nothing starts a new pull after `ServerAheadError`,
  so `awaiting-pull` can persist until the next boot.
- Suspension in the session owner is detected at runtime, not by types.
- With `onError: 'ignore'` (the leader layer's default), a leader sync failure
  stops the processor without notifying the shutdown channel.
- `cachedPullItems` in the leader's session pull path can grow without bound
  (`:1127-1129`; issue #1423).
- Metrics for retry/queue health are not emitted (LS.SYS.OBS-DQ2).
