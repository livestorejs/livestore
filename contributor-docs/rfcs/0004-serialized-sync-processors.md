# Serialized Sync Processors

> **Status: draft.** This proposal has not been accepted. An implementation is available for review. Until the RFC is
> accepted, its design and the terms it coins (owner, outbox, job, runner, `LeaderPersistence`, persist receipt) live
> only here. On acceptance they fold into
> [`context/02-system/03-sync/02-processors/`](../../context/02-system/03-sync/02-processors/spec.md), with the commit
> path in [`05-store/`](../../context/02-system/05-store/spec.md) and the terms in
> [`ontology.md`](../../context/ontology.md). The session uses approach C: one synchronous owner with yielding
> reconciliation, including the readability refactor at `66ca5d3e0` and the explicit-state follow-up of September 24,
> 2026 (tagged lifecycle, a `cancelling` push state, enforced synchronous owner). The leader is a serialized mailbox that
> writes through `LeaderPersistence`. Alternatives remain preserved on named branches.

This work builds on Igor Gassmann's `MaterializationJournal` (the service landed in #1531) and role-specific SQLite
Effect service extraction (`StateSqliteDb`, `EventlogSqliteDb`, `StateHead`). It
preserves that storage architecture and adds a more explicit orchestration model above it, with
`LeaderPersistence` providing the focused durable seam used by the leader processor.

## In One Minute

LiveStore has two sync processors:

- `ClientSessionSyncProcessor` keeps one Store responsive and reconciles it with the leader.
- `LeaderSyncProcessor` combines all client sessions with the sync backend.

Previously, their behaviour emerged from several queues, semaphores, long-running fibers, mutable references, and
restart rules working together. To understand whether a push could run, a maintainer had to inspect all of them and
reconstruct their timing.

Now, named messages enter one state-changing owner in each processor. The leader uses a serialized mailbox loop. It
delegates durable SQLite work to `LeaderPersistence` and only publishes or acknowledges after that work succeeds.
The session uses a synchronous owner: local commits, pull steps and network results all run through `owned`, which
finishes each state change synchronously and fails the session loudly if one ever suspends. An asynchronous runner handles
waiting and applies incoming history one complete SQLite/model step at a time, yielding between steps.

This is not a framework-driven or fully pure state machine. The session owner is effectful and is not a FIFO
mailbox. It finishes state changes synchronously, then releases its outbox of notifications and jobs. Both processors make
ordering and the important states visible without introducing another production module.

## Two Variations on a Classical State Machine

Both processors run the same tiny machine. Something is either synced with its upstream, or it has local changes still
waiting for it. A client session's upstream is the leader; the leader's upstream is the sync backend.

```text
              local change               upstream confirms
  [ synced ] ─────────────► [ pending ] ───────────────────► [ synced ]
```

A classical state machine runs this with four rules. Both processors break some of them:

| Classical rule                                      | Leader                                              | Client session                                   |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Pure: a transition only computes the next state     | Breaks it: writes to disk (via `LeaderPersistence`) | Breaks it: writes to SQLite itself               |
| Slow work is handed back as an output               | Starts background work itself                       | Hands slow work to a helper, the runner          |
| One message at a time, and a transition never waits | One at a time, but a transition may wait            | One at a time, never waits, and there's no queue |
| The sender gets no answer                           | The sender gets an acknowledgement later            | The caller gets an answer immediately            |

### Leader: the same machine behind a mailbox

Messages queue up in a mailbox and are handled one at a time, as in a classical machine. The differences are what
happens inside a turn.

```text
  messages ─► [ mailbox ] ─► handle one message
                   ▲              │  writes to disk via LeaderPersistence and waits for it:
                   │              │  the mailbox waits too
                   │              └─► starts "send #7 to the sync backend" in the background
                   │                         │
                   └──── "sync backend confirmed #7" arrives later, as a new message
```

- **It does the work itself:** a transition writes to disk through `LeaderPersistence` and waits for that write.
- **Background work comes back as a message:** sending to the sync backend runs in the background and reports back
  through the mailbox.
- **Old answers are ignored:** if #7 was replaced in the meantime, its confirmation is thrown away.

### Client session: the same machine without a mailbox

The app is waiting on every local change: `store.commit` must return with the change already applied. A change
therefore can't sit in a mailbox behind other work. It's handled the moment it arrives. That has one consequence:
since nothing is queued, a turn must never wait, or it would block the app. Waiting is moved to a helper, the runner,
which reports back with a new message when it's done.

```text
  local change ─► handle it right now (no mailbox)
                     │  writes to SQLite itself, but may never wait
                     │  answers the caller immediately
                     └─► hands "send #7 to the leader" to the runner
                                    │
                         runner waits for the leader
                                    │
  "leader confirmed #7" ◄───────────┘  handled right now, like any other message
```

- **No mailbox:** every message is handled immediately, so a local change is visible as soon as `commit` returns.
- **Never waits:** a turn must finish on the spot. All waiting happens in the runner.
- **Background work comes back as a message,** as in the leader.
- **Old answers are ignored,** as in the leader.
- **Big incoming batches are applied in small pieces,** so local changes can get in between them.

**In one line:** the leader is a classical mailbox machine whose turns can do slow work. The session has no mailbox,
so its turns are instant, and a runner does the waiting for it.

## Coordination State We No Longer Have to Reconstruct

The main simplification is not that every queue or fiber disappeared. It is that queues, locks, fibers, booleans, and
references no longer jointly encode the current synchronization state.

### Leader processor

Before the refactor, the leader's control flow depended on all of these at once:

| Previous coordination mechanism                              | What it was encoding                                | What owns that information now                                                    |
| ------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `localPushesQueue`                                           | local work waiting to be applied                    | `model.localQueue`                                                                |
| `syncBackendPushQueue`                                       | events waiting for backend propagation              | the tagged `model.push` state                                                     |
| `localPushBackendPullMutex`                                  | whether local or upstream durable work could run    | mailbox ordering and `processNextWork`                                            |
| `pushAdmissionSemaphore`                                     | atomic validation and reservation of local pushes   | the single mailbox handler                                                        |
| `reservedLocalPushItems`                                     | admitted events not yet committed or rejected       | `model.localQueue`                                                                |
| `pushHeadRef`                                                | the validation fence including reservations         | the tail of `model.localQueue`, or the durable local head when the queue is empty |
| `pullMutexHeld`                                              | whether pagination was blocking local work          | `model.pull.pagination`                                                           |
| `ctxRef`                                                     | runtime dependencies needed by background effects   | explicit construction-time dependencies                                           |
| an optional `syncStateSref` initialized during boot          | state shared between independent background workers | `model.syncState` for decisions and an initialized observable ref for subscribers |
| a long-running local-apply worker                            | draining and batching local pushes                  | `ContinueWork` turns in the mailbox                                               |
| a restartable backend-push worker                            | push progress, retry, and replacement after rebase  | tagged push states plus correlated completion messages                            |
| `Effect.retry`, schedule metadata, and a local retry counter | when and why a provider call would run again        | `retry-wait` states and retry messages with identities                            |
| one acknowledgement `Deferred` per event                     | completion of a caller's batch                      | one request-level acknowledgement with a remaining-event count                    |

The queues and reservations have not disappeared as domain concepts (a reservation is now an admitted entry in
`localQueue`). They are now fields in one model, changed by one
owner, rather than independent synchronization primitives that can disagree.

### Client-session processor

The session processor had a similar set of implicit controls:

| Previous coordination mechanism                   | What it was encoding                                          | What owns that information now                                    |
| ------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `leaderPushQueue`                                 | pending events and whether propagation was active             | the tagged `model.push` state                                     |
| `pullReconciliationMutex`                         | exclusion between pull, rejection recovery, and shutdown      | the synchronous owner, reconciliation identity and lifecycle tags |
| `unresolvedRejection`                             | whether propagation was waiting for corrective leader history | `push: awaiting-reconciliation`                                   |
| `terminalPushCause`                               | whether the background worker had failed                      | `lifecycle: failed { cause }`                                     |
| a permanent push-drain worker                     | batching, propagation, and parking after rejection            | one finite push operation at a time                               |
| `Effect.never` in that worker                     | a rejection fence waiting for corrective history              | the explicit `awaiting-reconciliation` state                      |
| clearing and restarting that worker during rebase | invalidating an old push plan                                 | `push: cancelling`, `PushCancelled`, and rebuilding from pending  |

Some runtime machinery remains, but with narrower jobs:

- the leader mailbox carries messages; the session job queue schedules asynchronous work;
- fiber handles own the lifetime of actual concurrent provider or leader calls;
- deferred values let callers await an acknowledgement or let a pull stream apply backpressure;
- shutdown state keeps repeated shutdown requests idempotent.

These are adapters around the model. They no longer compete with it as sources of orchestration truth.

## The New Shape

```text
┌────────────────────────── one client session ──────────────────────────┐
│                                                                        │
│  Store.commit                                                          │
│      │                                                                 │
│      ▼                                                                 │
│  ClientSessionSyncProcessor                                            │
│    ├─ one synchronous owner: local commits, pull steps, push results   │
│    └─ async runner: network, cancellation, refresh, yield, shutdown    │
│                         │                                              │
└─────────────────────────┼──────────────────────────────────────────────┘
                          │ leaderThread.events.push / pull
                          ▼
┌──────────────────────────── leader thread ─────────────────────────────┐
│                                                                        │
│  LeaderSyncProcessor                                                   │
│    ├─ one mailbox                                                      │
│    ├─ one explicit model                                               │
│    ├─ session publication and acknowledgements                         │
│    └─ provider pull, push, and retry orchestration                     │
│                  │                            │                        │
│                  ▼                            ▼                        │
│       LeaderPersistence                    Sync backend                │
│       durable SQLite work                 pull / push                  │
│          │           │                                                 │
│          ▼           ▼                                                 │
│       state DB    eventlog DB                                          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

The three modules have distinct responsibilities:

| Module                       | Owns                                                                                                          | Does not own                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ClientSessionSyncProcessor` | optimistic session state, leader propagation, stepped reconciliation, pull refresh, session shutdown          | Store's local subscriber refresh, leader durability or backend retries |
| `LeaderSyncProcessor`        | event ordering, in-memory sync state, session publication, acknowledgements, provider work, retries, shutdown | SQLite transition details                                              |
| `LeaderPersistence`          | materialization, rollback, journal maintenance, heads, eventlog writes, coordinated SQLite commits            | queues, publication, retries, acknowledgements, or lifecycle           |

## Message Handling in Detail

### Leader: a serialized mailbox

```text
external request or async completion
              │
              ▼
       tagged Message
              │
              ▼
         mailbox queue
              │
              ▼
      handle one message fully
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
 update Model   start/await work
                     │
                     ▼
              result returns as
              a correlated Message
```

There is one important distinction between kinds of work:

- durable leader work is awaited inside the mailbox turn, so nothing can observe a half-applied transition;
- genuinely concurrent work, such as a provider request or retry timer, runs in a supervised fiber and reports its
  outcome back to the mailbox as a message.

Every concurrent operation has an identity. A late completion is ignored when its identity no longer matches the
current state.

The leader still makes every decision one message at a time; only waiting runs concurrently. Exactly three kinds of
waiting have to happen outside a turn, because each could block the mailbox indefinitely:

- **Pull from the sync backend** (at most one): a live stream that can sit idle for hours waiting for other clients'
  changes. Pages within it stay serial: the stream waits until each page is durably written (or discarded) before
  delivering the next.
- **Push to the sync backend** (at most one): a network round trip that can hang or keep failing while offline.
  Awaited inside a turn, sessions' local changes could not become durable and shutdown could not proceed.
- **Retry timers**: back-off sleeps of seconds. A superseded timer keeps sleeping, but its `retryId` no longer
  matches, so its message is ignored.

A fully serial leader would need a polling, non-live pull (a different sync-provider contract), would block on every
push round trip, and would freeze while offline. A push rejected because the backend is ahead can only succeed after
a pull, which a frozen leader cannot run. The cost of the concurrent waiting is modest and visible in the model:
operation identities, the `awaiting-pull` push state, and interrupting an in-flight push when an upstream page
rebuilds the push plan. That happens on every upstream page, not only when a rebase replaces the batch; main also
interrupts its push on every advance.

### Session: synchronous changes, asynchronous waiting

**Every change to the session model completes synchronously inside the owner. Work that must wait happens outside
that owner, then enters it again using the current state.** Local commits and incoming history use the same owner, so
neither can interrupt the other's unfinished SQLite/model work.

The file uses seven terms:

- **Owner**: `owned(body)`, the only code allowed to write `model`. It is not a thread, a mailbox, or a lock held
  throughout a pull. Exclusion relies on the body being synchronous. A synchronous body always finishes before any
  microtask runs, so `owned` schedules one: if it still finds the body holding the owner, the body suspended. That
  body then fails the session with a named defect, and callers that meet the held owner get the same defect.
  Running the body on a separate synchronous fiber (`Effect.runSyncExitWith`) would catch this earlier, but it
  measurably slowed a 10,000-event commit in the perf suite, so it was rejected.
- **Message**: a tagged `SessionMessage` that changes the model without returning a result, entered through
  `dispatch(message)`. `commit` and one pull step are the two owner calls that do return a result (`writeTables`, or
  a `StepResult`). Messages are never called events: "event" is reserved for LiveStore events.
- **Job**: asynchronous work for the runner (`Push`, `Reconcile`, shutdown steps). The owner may never wait, so
  anything that involves waiting is written down as a job; the runner does it and reports back with a message.
- **Notification**: tells whoever is waiting that a change finished. `syncState` subscribers get the new state, the
  pull stream learns that a pull is done, and a shutdown caller learns that shutdown finished. Technically a Queue
  offer or a Deferred completion.
- **Outbox**: where the owner holds notifications and jobs while it works. Like a transactional outbox, it is
  delivered after the owner is released and dropped if the change fails. Waking waiting code runs it immediately, in
  the caller's stack, so delivering mid-change would let that code see half-finished state or re-enter the owner.
- **Runner**: the Effect code that takes jobs, manages asynchronous operations and advances reconciliation.
  It has no second model to write; its only loop state is the offset into the pull being applied.
- **Savepoint**: a SQLite `SAVEPOINT` on the session's state database. Because the journal and the state head are
  tables in that same database, one savepoint covers materialization, journal and head together. On failure it rolls back to where it started. The in-memory sync state is
  not SQLite, so it is updated only after the savepoint is released. (The leader uses plain transactions instead.)

This is close to an Elm-style `update` returning `(model, Cmd)`, except the owner adds jobs to its outbox
imperatively instead of returning them. Updating in-memory sync state means assigning the new event heads,
pending local events and relevant push state after the SQLite changes succeed.

Read the following views separately. Boxes marked OWNER contain synchronous state changes; waits and callbacks
are outside those boxes. Time runs downward in the sequence view. Its lanes represent responsibilities in the
client, not separate operating-system threads.

#### 1. What does Store.commit wait for?

```text
Store.commit(events)
   |   Effect.runSyncWith: returns or throws, never waits
   v
+-- ONE SYNCHRONOUS CALL STACK: no event-loop turn until Store.commit returns --+
|                                                                               |
|  processor.commit(events)                                                     |
|  +------------------------------------------------------------------------+   |
|  | OWNER: owned(commitLocalEvents)                                        |   |
|  |                                                                        |   |
|  | Check admission; encode; merge                                         |   |
|  | Savepoint: materialize batch, journal, state head                      |   |
|  | Update in-memory sync state to match SQLite                            |   |
|  | Outbox: sync-state notification, Push job if eligible                  |   |
|  +------------------------------------------------------------------------+   |
|  release owner                                                                |
|  deliver notifications --> waiting fibers resume inline, in this stack:       |
|                              - syncState subscribers                          |
|                              - runner: starts the leader push                 |
|                            each runs until it suspends or yields              |
|  return writeTables                                                           |
|                                                                               |
|  Store refreshes subscribers (reactivityGraph.setRefs)                        |
|    callbacks run here; one may call Store.commit again (nested, also sync)    |
|                                                                               |
+-------------------------------------------------------------------------------+
   |
   v
Store.commit returns: LOCAL CHANGE APPLIED (no leader or backend ack awaited)

- - - - - - - - - - - - - - later, after the event loop runs - - - - - - - - - - -

leader push completes (worker round trip)
   |
   v
runner reports PushSucceeded | PushRejected | PushFailed
   |
   v
+------------------------------------------------------------+
| OWNER: dispatch(message); a stale operation id is ignored  |
+------------------------------------------------------------+
```

Everything inside the large box runs in one synchronous JavaScript call stack. `Store.commit` runs the whole commit
through `Effect.runSyncWith`, which returns or throws but never waits. Inside the owner, `PreventSchedulerYield` turns off
Effect's automatic yields. Outside it, `runSyncWith` drains any automatic yield before it returns. No browser input, timer
or other task runs until `Store.commit` returns. If something on this path does suspend, such as an asynchronous Schema
transform or materializer, `runSyncWith` throws instead of waiting, and the owner's suspension check fails the session.

Synchronous does not mean that only this commit's code runs. Offering an Effect Queue or completing a Deferred resumes
the waiting fiber inline: Effect calls `fiber.evaluate` in the caller's stack. Delivering the outbox
therefore runs `syncState` subscribers and the runner inside `Store.commit`, before Store refreshes its own
tables. A resumed fiber keeps its own scheduler settings, so it runs until it suspends or reaches an automatic yield,
and whatever remains continues after `Store.commit` returns. The leader push can therefore start inside
`Store.commit`, but its result always arrives later. Because the outbox is held until the owner is released,
this resumed code always sees finished state.

Store's subscriber callbacks run inside the same call. They, and code resumed by notifications, may commit again. A
nested commit runs this whole path, including its own table refresh, before the outer commit continues. Model state
stays coherent; only the order of reactive refreshes can be nested.

Below the dashed line is the asynchronous part. The owner records the push as in flight before adding its job to the outbox, so
the runner only sends work the model already tracks. When the leader call completes, the runner reports
`PushSucceeded`, `PushRejected` or `PushFailed` as a new message, and the owner ignores it if its operation id is stale.
A push can also be deferred, for example during reconciliation; the local commit still completes immediately.

Failures of asynchronous work take the same route back. A typed leader rejection becomes `PushRejected`, which is
recoverable: the push waits in `awaiting-reconciliation` for the corrective pull. Any other push failure becomes
`PushFailed`. A failing pull stream, a failing reconciliation step, or a failure while handling any of these messages
is reported as `Failed`. Interrupts report nothing, because whoever interrupted the work (a rebase or shutdown) has
already changed the model. `Failed` moves the lifecycle to `failed` and adds a `NotifyFailure` job, which stops the pull
and push fibers and shuts down the Store. If even `Failed` cannot be recorded, because a suspended body still holds
the owner, the processor logs both causes and shuts down the Store directly.

The diagram shows the successful path. If materialization fails, the savepoint rolls back, in-memory sync state stays
unchanged, the outbox is dropped, and Store shuts down with the error.

#### 2. Where can a local commit run during a pull?

```text
  App / subscriber              Shared dispatch owner               Async runner
          |                               |                               |
          |                               |<---------- PullStep ----------|
          |                  +------------+------------+                  |
          |                  | OWNER                   |                  |
          |                  | Merge live pending      |                  |
          |                  | Finish SQLite changes   |                  |
          |                  | Update in-memory state  |                  |
          |                  | to match SQLite         |                  |
          |                  +------------+------------+                  |
          |                               |                               |
          |                               |--- release; notify; return -->|
          |                               |                        refresh / yield
          |                               |                               |
          |------- Store.commit(L) ------>|                               |
          |                  +------------+------------+                  |
          |                  | SAME OWNER              |                  |
          |                  | Apply L locally         |                  |
          |                  | Update pending state    |                  |
          |                  +------------+------------+                  |
          |                               |                               |
          |<-- release; notify; return ---|                               |
  Store refreshes;                        |                               |
   commit returns                         |                               |
          |                               |                               |
          |                               |<------- next PullStep --------|
          |                  +------------+------------+                  |
          |                  | SAME OWNER              |                  |
          |                  | Merge CURRENT pending   |                  |
          |                  | (now accounting for L)  |                  |
          |                  | Finish SQLite changes   |                  |
          |                  | Update in-memory state  |                  |
          |                  | to match SQLite         |                  |
          |                  +------------+------------+                  |
          |                               |                               |
          |                               |--- release; notify; return -->|
          |                               |                        refresh / yield
          |                               |                               |

  One possible interleaving: L completes between two complete pull steps.
  No wait, yield or subscriber callback occurs inside an OWNER box.
```

This is one possible successful interleaving after a pull has been accepted. Each owner box represents
a complete synchronous SQLite/model step. After that step, the runner refreshes subscribers and yields before the
next step. A subscriber can commit during refresh; a browser handler may run when scheduling gives it an opportunity.
The sequence shows a commit between steps, without promising that one occurs at every yield. Notifications can also
resume other fibers immediately after owner release, before the step returns to the runner.

The next step **merges again from live pending events**. It cannot reuse a plan made before the local commit. A
concrete example, assuming neither incoming prefix confirms local event L:

| Completed transition                                                 | Materialized counter | Still-pending local work |
| -------------------------------------------------------------------- | -------------------- | ------------------------ |
| First incoming prefix leaves the counter at 1                        | 1                    | none                     |
| Local L increments the counter by 10                                 | 11                   | L: increment by 10       |
| Next incoming prefix sets the counter to 2; reconciliation replays L | 12                   | L: increment by 10       |

At every pause, rows, journal and head describe a complete incoming prefix plus the current optimistic events.
The reader can see intermediate states such as 11 and 12; it must never see a new head paired with unfinished rows.
If incoming history confirms L, the merge removes it from pending instead of applying it twice.

Only the last step discards the journal through the payload's confirmed global head. After the last refresh,
`dispatch(PullFinished)` finishes reconciliation and resumes eligible propagation. After a rebase or a recovered
rejection it first rebuilds the push queue from current pending state.
There is no yield required after the final step. A complete step or its subscriber work can still be expensive:
this design provides interleaving opportunities, not a hard browser frame-time bound.

#### 3. What if applying a step first requires asynchronous cancellation?

```text
    Runner runs a pull step in the owner
                   |
                   v
    +--------------------------------------------+
    | OWNER: merge detects cancellation needed   |
    | push: in-flight -> cancelling              |
    | Return cancel-push; nothing else changes   |
    +--------------------------------------------+
                   |
             release owner
                   |
    Runner interrupts old push and waits
                   :
                   :     Store.commit(L) may run during this wait
                   :     +--------------------------------------+
                   :     | SAME OWNER: apply L; queue behind    |
                   :     | the cancelling push                  |
                   :     +--------------------------------------+
                   :     Release; notify; refresh; commit returns
                   :
                   :     A late success or rejection of the
                   :     cancelling push is ignored; a fatal
                   :     failure still fails the session.
                   :
    Cancellation finishes
                   |
    dispatch(PushCancelled): cancelling -> idle
                   |
    Retry the SAME incoming prefix
                   |
                   v
    +--------------------------------------------+
    | OWNER: recompute merge from LIVE state     |
    |                                            |
    | One savepoint:                             |
    |   rollback -> materialize -> replay -> head|
    | Update in-memory sync state to match       |
    | SQLite (including L)                       |
    +--------------------------------------------+
                   |
             release owner
                   |
             notify / refresh

    The wait holds neither the owner nor a reconciliation savepoint.
    The merge computed before the wait is never reused as a write plan.
```

This view shows the rebase path with a local commit during the cancellation wait. The first attempt detects that
cancellation is needed, records `push: cancelling`, and returns `cancel-push` **before changing SQLite or sync
state**. The cancellation is therefore visible in the model, not only in the runner. The runner then interrupts the
old push outside the owner and reports `PushCancelled` for that operation. No reconciliation savepoint spans that wait, so a local commit can finish
against the previous coherent state.

Once cancellation finishes, the runner retries the same incoming prefix. The owner recomputes its merge, including
any local events committed during the wait, then applies rollback, incoming materialization, pending replay and head
updates together in one savepoint. It then updates in-memory sync state to match SQLite before releasing
notifications. If that SQLite step fails, its savepoint rolls back; earlier completed steps remain. A stopped or failed reconciliation is rejected
by the lifecycle/identity guard instead of applying a late step.

**The safety rule is the same in all three views:** finish the SQLite changes and update in-memory sync state to
match before permitting another caller to observe or change session state. Waiting, notifications and subscriber callbacks belong outside that
boundary. The job queue schedules work; sequence numbers and `SyncState.merge` determine valid event history.

**How in-memory sync state stays consistent with SQLite.** The in-memory `localHead` matches the state head table,
and the pending events match their materialized rows and journal changesets. Three rules inside the owner keep them
in agreement at every owner release, which is the only moment another caller can observe either:

1. SQLite first, then memory: SQLite is written inside a savepoint, and `model.syncState` is assigned only after the
   savepoint is released.
2. Nobody can look in between: both happen in one synchronous owner body, and notifications are held back until the
   owner is released.
3. Failure leaves both untouched: the savepoint rolls back, and the in-memory assignment never runs.

They also start in agreement: at boot, the adapter reads the head from the session's SQLite, and the processor starts
from it with no pending events. They can only diverge when the session is already failing: a rollback that itself
fails, or a body that breaks the synchronous contract. Both fail the session. Nothing else writes the session's
SQLite after boot, though the types do not prevent it. Agreement is checked by tests that compare the SQLite head with
`syncState.localHead` (`ClientSessionReconciliation.test.ts`), not at runtime.

## The States That Matter

### Leader

```text
lifecycle:  starting ──► running ──► stopping
                            └──────► failed

pull:       disabled
            streaming { between-pages | more-expected }
            retry-wait
            completed

push:       disabled
            idle
            in-flight
            retry-wait
            awaiting-pull
```

The model also holds the current `SyncState` and the local and upstream work waiting for the next mailbox turn
(`localQueue`, `upstreamQueue`). There is no separate reservation list: a local push is admitted against the tail of
`localQueue`, or the local head when the queue is empty. Upstream pages are processed before more local work. When a page says more pages are coming, local work
waits until that upstream sequence is complete.

### Client session

Every field that affects a later decision is part of `Model`. Lifecycle and push are tagged unions, so combinations
such as "running with a terminal cause" cannot be constructed.

```text
lifecycle:
  starting ─────────► running { reconciliation? }
     │                    │
     └────────────────────┴──► shutdown-requested { exit, reconciliation? } ──► stopping { exit } ──► stopped
                                                                                                       ▲
  starting / running / shutdown-requested / stopping ──► failed { cause, shutdownExit? } ─────────────┘

push:
  idle { queued }                          ──► in-flight                 reserveNextPush
  in-flight { operationId, batch, queued } ──► idle                      PushSucceeded, or a recovered PushRejected
  in-flight                                ──► awaiting-reconciliation   PushRejected
  in-flight                                ──► cancelling                a pull step needs a rebase
  cancelling { operationId, batch, queued } ─► idle                      PushCancelled (batch requeued)
  awaiting-reconciliation { error, ... }   ──► idle                      rebase step, or PullFinished sees recovery
  any                                      ──► idle                      applied rebase step (queue = live pending)

reconciliation (inside running / shutdown-requested):
  undefined ──► { id, rebased } ──► complete step ──► yield ──► next step ──► undefined
```

Transitions that change `lifecycle` or `push`, and what each puts in the outbox:

| Message or call     | From                            | To                                               | Outbox                                                                    |
| ------------------- | ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `Started`           | starting                        | running                                          |                                                                           |
| `commit`            | running (else defect)           | push `queued` grows (unless awaiting)            | sync-state update; `Push` if idle                                         |
| `PullReceived`      | running                         | reconciliation `{ id, rebased: false }`          | `Reconcile`                                                               |
| pull step, rebase   | push in-flight                  | push cancelling                                  | (returns `cancel-push`)                                                   |
| `PushCancelled`     | push cancelling, same operation | push idle, batch requeued                        |                                                                           |
| pull step, applied  | reconciliation active           | sync state; rebase: push idle, `rebased: true`   | sync-state update                                                         |
| `PullFinished`      | reconciliation active           | reconciliation cleared; push rebuilt if needed   | `Push` if eligible                                                        |
| `PushSucceeded`     | push in-flight, same operation  | push idle                                        | next `Push`, or `FinishShutdown` if done                                  |
| `PushRejected`      | push in-flight, same operation  | push idle (recovered) or awaiting-reconciliation | next `Push`; `FinishShutdown` if stopping                                 |
| `PushFailed`        | push in-flight or cancelling    | failed                                           | `NotifyFailure` or `FinishShutdown`                                       |
| `ShutdownRequested` | starting / running              | shutdown-requested                               | `BeginShutdown`                                                           |
| `ShutdownRequested` | failed, not yet requested       | failed with `shutdownExit`                       | `FinishShutdown`                                                          |
| `DrainStarted`      | shutdown-requested              | stopping                                         | next `Push` or `FinishShutdown`; only `FinishShutdown` for a failure exit |
| `DrainStarted`      | failed                          | (unchanged)                                      | `FinishShutdown`                                                          |
| `Failed`            | any live state                  | failed                                           | `NotifyFailure`, or `FinishShutdown` if stopping                          |
| `Stopped`           | any                             | stopped                                          | shutdown result                                                           |

A failed session never re-enters `stopping`: nothing is drained after a fatal error, and push completions are ignored.

`Store.commit` calls `processor.commit(events)`, which enters the same owner used by pull steps and completions.
There is no session mailbox-ownership exception and no delayed `LocalPushAdmitted` message. Pull reconciliation yields
only after a complete SQLite/model step, and merges again from live pending events when it resumes. The runner handles
one job at a time, so `BeginShutdown`, `FinishShutdown` and `NotifyFailure` wait behind an active `Reconcile`,
including its cancellation wait and yields. A failure still takes effect at the next step, because it clears the
reconciliation and every later step is then obsolete.

Shutdown closes admission immediately, finishes the accepted pull, then drains the rebuilt pending suffix. A shutdown
requested with a failure exit does not drain, and neither does a failed session.
A fatal completion can be handled between steps, unlike A's whole mailbox turn. It invalidates reconciliation so late
steps cannot apply. Rejection recovery likewise consults current state at pull completion, not a snapshot from pull start.

In development builds the owner also checks, after every successful body, that a cancelling push only exists during
reconciliation and that the push queue is the unpushed suffix of pending events outside reconciliation.

### Safe session reconciliation steps

The earlier split let a local commit land inside an unfinished rebase. It repaired the pending propagation queue, but
an older materialization could still overwrite the newer durable head. Independent inserts hid the corresponding
row-order problem. The full-Store regression tests now cover both head equality and noncommutative updates.

The single owner retains the safety rule established by fixed A: **every reconciliation pause exposes a complete
upstream prefix plus all current optimistic events, with matching SQLite state, journal, and in-memory head**.

1. Validate the complete incoming payload before applying a prefix.
2. If a step needs a rebase, cancel the old push while leaving the old committed model intact. New local commits can
   still finish during this wait. Recompute the merge afterward; the pre-cancellation result is not a durable plan.
3. Normally apply up to 32 upstream events against the live pending suffix. An explicit leader rebase's first step
   must replace enough history to reach the old upstream head before yielding. Rollback, incoming materialization, pending replay,
   and the state head share one savepoint (a SQLite `SAVEPOINT`; see the session terms in "Message Handling in
   Detail"). Suppress automatic Effect scheduler yields during this synchronous work.
4. After success, update in-memory sync state to match SQLite, release the owner, and deliver the outbox.
   The runner refreshes affected tables. Subscriber callbacks may commit at this point. Yield before the next step so other fibers and user input can run.
5. Only the final step discards the journal through the payload's confirmed `globalHead`. After a rebase or a recovered
   rejection, rebuild propagation from the final pending suffix once reconciliation completes. No replacement push starts during reconciliation, and there
   are no delayed admission messages to repair.

This does not add another state-machine layer. `ClientSessionSyncProcessor` retains orchestration;
the existing SQLite, journal and state-head services retain storage responsibilities. Within Store, those services
use the cache-aware SQLite adapter so changeset/savepoint rollback cannot leave query results cached from old history.
Because journal rollback does not return affected table names, a rollback conservatively refreshes all user tables.

The production materializer, journal and head effects must remain synchronous, as required by `Store.commit` too.
`PreventSchedulerYield` suppresses automatic yielding; it does not make a genuinely asynchronous effect synchronous.
No network wait, cancellation, timer, or test barrier belongs inside the savepoint/model step.

Consequential behavior and limits:

- Subscribers may observe complete intermediate prefixes instead of only the end of a pull batch. They never need
  to interpret a planned head whose rows have not been applied yet.
- If a later step fails, earlier committed prefixes remain. The failing step rolls back and the processor fails.
  This is step atomicity, not whole-payload atomicity. Cleanup failures still mean the connection cannot be trusted.
- Admission is checked before encoding/materialization under the same owner. A local batch uses one savepoint:
  a materialization failure rolls back the whole batch without updating in-memory sync state or scheduling propagation.
- A pending event rebased onto the end of one prefix can be confirmed by a matching event in the next prefix. The
  tests require confirmation rather than duplicating that event. Arbitrary batch partitions are not guaranteed to
  produce identical merge outcomes under the old whole-batch algorithm.
- A step bounds incoming event count, not elapsed time: replaying a large pending suffix, rolling back a large leader
  rebase, expensive materializers, and subscriber work can still cause a long task. There is no hard frame-time bound.
- Session SQLite/head consistency is not a promise that an unacknowledged local event survives a crash. Leader
  acknowledgement and cross-database crash atomicity retain their existing meanings and limits.

## Representative Call Stacks

### 1. A local Store commit reaches the backend

```text
Store.commit
  ├─ ClientSessionSyncProcessor.commit
  │    └─ owned(commitLocalEvents)
  │         ├─ check admission, encode, merge
  │         ├─ savepoint: materialize batch, journal and head
  │         ├─ update in-memory sync state to match SQLite
  │         ├─ reserve propagation if allowed
  │         └─ release owner; deliver outbox (notifications, jobs)
  └─ Store refreshes local subscribers; return synchronously

session runner
  └─ Push job → startLeaderPush
       └─ leaderThread.events.push
            └─ LeaderSyncProcessor.push
                 ├─ register acknowledgement
                 └─ mailbox: LocalPushRequested
                      ├─ validate against the localQueue tail; queue the batch
                      └─ mailbox: ContinueWork
                           └─ processLocalBatch
                                ├─ SyncState.merge
                                ├─ LeaderPersistence.persistLocal
                                │    ├─ materialize into state DB
                                │    ├─ update journal and heads
                                │    └─ coordinate SQLite commits
                                ├─ publish committed receipt to sessions
                                ├─ add committed events to provider push state
                                └─ resolve acknowledgement
                                     └─ session dispatch(PushSucceeded)

provider push fiber
  └─ syncBackend.push
       └─ mailbox: PushSucceeded or PushFailed
```

The leader acknowledgement means the batch is durable, published, and scheduled for backend propagation. It does not
mean the backend has already accepted it.

### 2. An upstream page reaches all sessions

```text
provider pull fiber
  └─ syncBackend.pull
       └─ mailbox: UpstreamBatchReceived
            └─ mailbox: ContinueWork
                 └─ processUpstreamBatch
                      ├─ SyncState.merge
                      ├─ LeaderPersistence.persistUpstream
                      │    ├─ rollback divergent pending state when needed
                      │    ├─ materialize the replacement history
                      │    ├─ update journal, eventlog, state head
                      │    ├─ persist backend head with event inserts
                      │    └─ coordinate SQLite commits
                      ├─ publish committed receipt to session pull queues
                      ├─ release this provider page
                      └─ rebuild the provider push plan from committed pending

session leader-pull fiber
  └─ dispatch(PullReceived) → acceptPull
       ├─ validate full payload; register reconciliation identity
       └─ release owner; enqueue Reconcile job
            └─ reconcile (async runner)
                 ├─ owned(applyPullStep)
                 │    ├─ check identity and lifecycle; merge live pending
                 │    ├─ cancellation needed? push = cancelling; return without applying
                 │    ├─ applyPullToSqlite; update in-memory sync state to match SQLite
                 │    └─ release owner → notify
                 ├─ cancellation requested? wait outside owner, dispatch(PushCancelled), retry from live state
                 ├─ applied? refresh subscribers, yield, repeat
                 └─ dispatch(PullFinished) → finishPull
                      └─ release reconciliation; rebuild/reserve propagation
```

The provider stream waits for the leader's page-completion signal. A later page therefore cannot race ahead of the
durable cursor for the current page.

### 3. A provider push fails and retries

```text
syncBackend.push fails
  └─ mailbox: PushFailed { operationId }
       ├─ stale operationId? ignore
       ├─ server ahead? push = awaiting-pull
       ├─ backend identity mismatch? apply configured policy
       └─ transient failure? push = retry-wait
            └─ retry timer
                 └─ mailbox: PushRetryElapsed { retryId }
                      ├─ stale retryId? ignore
                      └─ start a new in-flight push
```

### 4. The leader rejects a session push

```text
leaderThread.events.push rejects
  └─ session dispatch(PushRejected { operationId }) → completePush
       ├─ stale operationId? ignore
       ├─ corrective pull already recovered it?
       │    └─ rebuild from live pending and continue
       └─ otherwise
            └─ push = awaiting-reconciliation
                 └─ accepted pull continues or a later PullReceived arrives
                      ├─ advance or rebase in complete steps
                      └─ PullFinished → finishPull
                           ├─ check current rejection against live pending
                           └─ rebuild/resume propagation if recovered
```

## Why This Is Easier to Reason About

A maintainer can now answer the main coordination questions in one place:

- **What can happen now?** Read the tagged lifecycle, pull, and push states.
- **What can change it?** Read the closed message unions (`SessionMessage`, `LeaderMessage`); in the session, add
  the two owner calls that return results (`commit` and a pull step).
- **In what order can changes happen?** Follow the leader mailbox, or session dispatch and the runner's safe yield points.
- **What makes a transition durable?** Follow the two methods on `LeaderPersistence`.
- **Can an old completion corrupt current work?** No; operation identities reject stale results.
- **Can the leader publish or acknowledge before durability?** No; those actions follow a successful persist receipt.
  Session publication is optimistic and only promises a completed local SQLite/model transition.

The processors still contain domain policy, because keeping that policy together is the point. The session's short
transition router leads to named workflows in the same file; `applyPullToSqlite` keeps the savepoint together, and the
async functions show exactly where waiting and callbacks can interleave. Jobs and the outbox add
concepts, but they do not add another production module or a continuation-event framework.

## Guarantees and Deliberate Limits

| Guarantee                                                                    | Status                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| One owner changes each processor's model                                     | leader mailbox; session synchronous dispatch                       |
| Session messages are processed in FIFO mailbox order                         | **not guaranteed or required**; dispatch is synchronous            |
| Local leader pushes are validated against committed plus admitted history    | guaranteed                                                         |
| Upstream pagination takes precedence over new local durable work             | guaranteed                                                         |
| Publication and acknowledgement happen only after LeaderPersistence succeeds | guaranteed                                                         |
| Late provider or leader-push completions cannot advance newer work           | guarded by operation identities                                    |
| Session async failures return to the owner as messages                       | guaranteed; if the owner cannot record one, Store shuts down       |
| Upstream persist receipts match the merged local head                        | by DAG position; the rebase generation is local                    |
| A session commit is immediately visible to that session                      | guaranteed by the synchronous owner before the call returns        |
| Session observers can reenter only after a completed transition              | owner released before the outbox and subscriber refresh            |
| Session owner work cannot suspend while holding the owner                    | detected; a suspending body fails the session with a named defect  |
| Store refreshes a commit's tables before any code it resumes runs            | **not guaranteed**; resumed code can refresh (and commit) first    |
| Session rows, journal and head agree at reconciliation yield points          | guaranteed for the synchronous SQLite/materializer implementations |
| In-memory sync state matches session SQLite at every owner release           | guaranteed by ordering inside the owner                            |
| A complete session pull payload is applied atomically                        | **not guaranteed**; complete prefixes may be visible               |
| Backend head and matching event inserts use the same eventlog transaction    | guaranteed                                                         |
| State DB and eventlog DB are crash-atomic together                           | **not guaranteed**                                                 |
| A leader acknowledgement means backend acceptance                            | **not guaranteed**; it means durable and scheduled                 |
| User input has a hard frame-time bound                                       | **not guaranteed**; a complete step can still be expensive         |

The state and eventlog databases use separate SQLite connections. `LeaderPersistence` coordinates their normal success and
rollback paths, but it cannot make them atomic across a process crash. State is committed first so the eventlog does not
claim a transition that never reached materialized state. A crash or eventlog commit failure after the state commit can
still leave state ahead of eventlog truth and requires a separate recovery strategy.

The backend confirms events without the leader's local rebase generation. When the leader rebases a pending event
before the backend accepts it (for example `e1` becomes `e2` with generation 1), the eventlog row and `StateHead` keep
generation 1 while the merged sync state adopts the backend's `e2`. The leader therefore checks upstream persist receipts
by global and client position, the same way `LeaderPersistence` matches confirmed events. Which of the two orderings occurs
depends on fiber scheduling.

## Reading Order

For a code review or architecture walkthrough, read the implementation in this order:

1. [ClientSessionSyncProcessor.ts](../../packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts):
   the `Model`, `Lifecycle` and `LeaderPushState` types at the bottom, then `transition` for the message map and `owned`
   for ownership and the outbox.
   Follow `commitLocalEvents` and `applyPullStep` for updates, `applyPullToSqlite` for persistence, and
   `reconcile` / `runJob` for waits, callbacks and yields. `boot` only acquires and starts the runtime.
   [Store.commit](../../packages/@livestore/livestore/src/store/store.ts) calls the processor and retains local refresh.
2. `LeaderSyncProcessor.ts`: the system-wide orchestration model, message vocabulary, and mailbox handler.
3. `LeaderPersistence.ts`: the durable transition implementation.
4. `ClientSessionSyncProcessor.test.ts`, `LeaderSyncProcessor.test.ts`, and `LeaderPersistence.test.ts`: races,
   transition invariants, and SQLite-backed behaviour.
5. `ClientSessionReconciliation.test.ts`: real-Store cancellation, ordered replay, durable heads, failure cleanup,
   intermediate prefixes, rollback cache invalidation, and subscriber commits.

## Choice, Alternatives and Evidence

This RFC proposes C: one synchronous session owner that reconciles in small, coherent, yielding steps, beside the
leader's serialized mailbox and `LeaderPersistence`. This is a readability and safety decision, not a measured
performance win over main, and it does not update accepted `context/` intent.

| Tried                                                  | Why it was not chosen                                                                                                                                                                                                            | Preserved at                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Split owner as on main (local commit path + mailbox)   | Unsafe: a local commit during an unfinished rebase could have its durable head overwritten (60 of 60 non-idle browser samples failed the head check; measured on an earlier prototype mailbox with the same split, not on main). | `experiment/session-sync-latency` at `e2edfa693`                          |
| Fixed split owner A (same coherent steps, two writers) | As safe and as fast as C, but two writers to audit, and push completions wait for the whole mailbox turn.                                                                                                                        | `codex/split-owner-a` at `4ead601cd`                                      |
| Whole-batch synchronous owner B                        | One owner, but applies an entire pull before yielding: user-input delay grows with batch size (497.3 ms vs 15.7 ms for the split owner on a 1,000-event rebase with 5 writes per event).                                         | `experiment/session-sync-latency` at `e2edfa693`                          |
| Owner body on its own fiber                            | Cleaner isolation, but about 4% slower on a 10,000-event commit; the body runs inline and a microtask check catches suspension.                                                                                                  | –                                                                         |
| Effect Machine statecharts (leader and session)        | Adds a framework dependency and vocabulary, deeply nested specifications and duplicated schemas to critical synchronization code.                                                                                                | `refactor/effect-machine-processors` at `db978b595`, spike at `18c0273a1` |
| Pure reducer + command interpreter                     | Represents every effect twice and separates a durable operation from the invariant it completes.                                                                                                                                 | –                                                                         |
| Guarding the first pull step by rebase generation      | Head ordering deliberately ignores the local rebase generation; the guard would invent a monotonicity contract the protocol lacks.                                                                                               | –                                                                         |

Evidence: a browser comparison of fixed A and C (130 samples) passed every correctness check for both,
with comparable user-input delay and catch-up times. The browser harness and its measurement interpretation are not
part of this change.
It does not compare against main and gives no frame-time bound. A known cost shared by A and C is replaying a large
pending suffix at every step: heavy rebases took about 2 seconds, a candidate for follow-up optimization.

## Topics to Look Into After Meeting With Igor (September 25, 2026)

1. **Rename the processors' "events".** _Done (October 7, 2026): renamed to **messages**._ The unions are now
   `SessionMessage` and `LeaderMessage` (for example `LocalPushRequested` and `UpstreamBatchReceived`), handled by
   `dispatch(message)` and `send(message)`. Of the 22 message types, only 3 are requests (`LocalPushRequested` and
   the two `ShutdownRequested`). The rest are results of work the processor started, arriving data, lifecycle
   reports, or the leader scheduling itself. "Message" covers all of them. It also completes the existing
   vocabulary: the leader's mailbox holds messages, and the session mirrors Elm's Model / Msg / Cmd. Rejected:
   "input" (too generic), "action" (only fits the 3 requests), "command", "notification" and "signal" (already
   used in LiveStore). Wire-protocol and devtools messages also exist, so always use the qualified names
   (`SessionMessage`, `LeaderMessage`, "mailbox message"), never a bare `Message`.
2. **What does `store.commit` wait for? (owner box in the diagrams)**
   - Left branch: confirm that the path from `store.commit` through the owner and the subscriber refresh until
     `store.commit` returns is fully synchronous, with nothing on it able to suspend or yield. _Answered (October 7,
     2026): yes, it is one synchronous call stack, enforced by `Effect.runSyncWith` and the owner's suspension check.
     Fibers woken by notifications and subscriber callbacks can run inside it. Diagram 1 was redrawn to show this,
     and to replace the nonexistent `dispatch(Commit)` with `owned(commitLocalEvents)`._
   - Right branch: when the asynchronous follow-up work fails (for example the push to the leader), is the failure fed
     back into the owner as a new message, or handled some other way? Trace each failure path. _Answered (October 7,
     2026): every failure returns to the owner as a message (`PushRejected`, `PushFailed` or `Failed`); see the
     paragraphs under diagram 1. The one exception, a `Failed` that the owner cannot record, used to die unobserved
     and now logs and shuts down the Store directly._
3. **Explain how these differ from conventional state machines.** Write a short primer for readers who know
   conventional synchronous state machines, focused on the client session's dispatcher: it makes synchronous
   transitions but coordinates asynchronous work (commands, runners, staged notifications). This needs a mental model
   or analogy, not a full specification. _Answered (October 7, 2026): see "Two Variations on a Classical State
   Machine" near the top._
4. **Check what "savepoint" means in the diagrams.** Presumably a SQLite `SAVEPOINT`, a nested transaction that can
   roll back cleanly to the state before it. Confirm it means that, and whether it wraps materialization, journal and
   state head together. _Answered (October 7, 2026): yes to both. The journal and the state head are tables in the
   same state database, so one savepoint covers all three. See the
   "Savepoint" term in "Message Handling in Detail"._
5. **Sync state versus in-memory SQLite.** How is the in-memory sync state (pending events, heads) kept consistent
   with the session's SQLite state? Is it guaranteed today, and if so, by what mechanism and at which points (for
   example yield points)? Where can the two diverge? _Answered (October 7, 2026): yes, at every owner release, by
   writing SQLite first inside a savepoint and assigning memory only afterwards, in one synchronous owner body. They
   diverge only in cases that fail the session. See "How in-memory sync state stays consistent with SQLite"._
6. **Rename `LeaderSyncCommitter`.** Consider something like "Materialization Service" or "Leader Materialization
   Service" to better describe its role. The name is not decided yet. _Decided (October 7, 2026): renamed to
   **`LeaderPersistence`**, with `persistLocal` / `persistUpstream` and `LocalPersistReceipt` / `UpstreamPersistReceipt`.
   The ontology already defines the leader as the role that owns "persistence and sync", so the leader now splits into
   `LeaderSyncProcessor` (sync) and `LeaderPersistence` (persistence). "Materialization Service" was rejected because
   half the work is eventlog writes, and the service calls a given `materializeEvent` rather than materializing
   itself. "Commit" was dropped because in LiveStore it means `store.commit`, adding new events, whereas this service
   durably writes events that were already committed or received._
7. **Notifications and commands in the client session processor.** Clarify how these two concepts work and why both
   exist: what the owner stages as notifications versus commands, when each is delivered or executed relative to
   releasing the owner, and what problem the split solves (for example reentrant observers, and asynchronous work
   started from synchronous transitions). _Answered (October 7, 2026): notifications tell whoever is waiting that a change finished; jobs
   (formerly "commands") hand slow work to the runner. The owner holds both in an outbox, delivered after release
   and dropped on failure, so woken code never sees half-finished state. "Command" was renamed to "job" because
   RFC 0002 makes Commands a public LiveStore concept. See the Job, Notification and Outbox terms in "Message
   Handling in Detail"._
8. **Does the leader need concurrent work at all?** "Leader: a serialized mailbox" separates durable leader work
   (awaited inside the mailbox turn) from genuinely concurrent work (provider requests, retry timers) running in
   supervised fibers. What actually has to run concurrently, and why? Could the leader be fully serial, so that its
   state machine never has to handle several things in flight at once? _Answered (October 7, 2026): it needs
   concurrent waiting, not concurrent decisions. Messages are still handled one at a time; only the live backend
   pull and the backend push (each at most one at a time) and retry timers wait outside a turn. Making these serial would
   change the sync-provider contract and freeze the leader while offline. See "Leader: a serialized mailbox"._
