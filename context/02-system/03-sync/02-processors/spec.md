# Sync Processors — Spec

This document specifies the leader- and session-side sync processors that
drive the [syncstate merge core](../01-syncstate/spec.md). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: queues, batching, retry, precedence, cursor/head tracking, and the
rebase critical sections of both processors. Does not define: merge
semantics (`../01-syncstate/`), materializer mechanics
(`../../02-state/01-sqlite/`), or processor placement (`../../04-runtime/`).

## Leader Sync Processor

`leader-thread/LeaderSyncProcessor.ts`. Two unbounded STM queues decouple
the three parties:

```
sessions ──push──▶ localPushesQueue ─(batch ≤10)─▶ merge+materialize ─▶
                                                     syncBackendPushQueue
                                                       ─(batch ≤50)─▶ backend
backend ──pull stream──▶ onNewPullChunk (precedence via semaphore)
```

- **Local pushes** (`:235-239, 263-296`): `localPushesQueue` holds
  `[event, deferred]` items; a background fiber drains
  `takeBetween(1, localPushBatchSize)` per cycle (default 10, `:214`).
  `validatePushBatch` requires strictly ascending batches
  (`NonMonotonicBatchError`) whose first event is ahead of
  `pushHeadRef.current` (`LeaderAheadError`) and whose complete sequence/parent
  chain is contiguous with that head (`NonContiguousBatchError`). Parent
  continuity compares global/client position because a confirmed leader head
  and a rebased session head may name the same position with different local
  generations. Admission atomically records explicit per-item reservations
  before queue publication; a reservation survives queue take and is released
  only when its item is applied, dropped, or rejected. Pull reconciliation
  derives `pushHead` from the authoritative head plus those live reservations,
  so in-flight or old-generation suffixes cannot leave a ghost fence or expose
  an unfenced gap (see
  [.decisions/0002-explicit-leader-push-reservations.md](./.decisions/0002-explicit-leader-push-reservations.md)).
- **Generations** (`:271-296, 321-366`): each queued item carries its
  seqNum's `rebaseGeneration`. After acquiring the mutex, items with a
  stale generation are dropped and their deferreds failed with
  `StaleRebaseGenerationError`. A merge `reject` fails the batch's
  deferreds with `LeaderAheadError`, bumps the generation, and drains
  same-generation queued items present at that moment — sessions rebase and
  re-push. The session driver fences later arrivals until that reconciliation;
  leader-side contiguous-chain validation rejects a later suffix that bypasses
  the fence (see resolved
  [DELTA-001](./.delta/DELTA-001-session-rejection-prefix-bypass.md)).
- **Backend pushing** (`:575-637`): drains
  `takeBetween(1, backendPushBatchSize)` (default 50, `:215`), pushes
  `toGlobal()` batches. Retry: `Schedule.exponential(1s)` clamped to 30s,
  no jitter, no attempt cap, and only for transient errors
  (`IsOfflineError`/`UnknownError`, `:627-631`). `ServerAheadError` is NOT
  retried in place: the push fiber parks on `Effect.never` (`:617-621`)
  and the pull side interrupts it — `restartBackendPushing` (`:729-741`)
  clears the fiber, re-seeds the queue from rebased pending, restarts.
- **Backend pulling** (`:397-573`): cursor =
  `Eventlog.getSyncBackendCursorInfo(remoteHead)` — the persisted backend
  head (`SYNC_STATUS_TABLE.head`) plus provider-opaque `syncMetadataJson`
  (`eventlog.ts:280-300`). Each chunk merges with
  `ignoreClientOnlyEvents: true`; advance restarts backend pushing with
  current pending, offers the payload to session pull queues, and persists
  sync metadata for confirmed events; rebase additionally rolls back
  state+eventlog rows and re-seeds pushing from rebased pending
  (`:466-516`). Backend head advances via `Eventlog.updateBackendHead`
  (`:462-464`).
- **Poison fence:** applying a non-empty pull chunk first pauses backend
  pushing. State rollback/materialization, eventlog writes, changesets, sync
  metadata, and the persisted backend cursor then share one rollback boundary.
  Only after that boundary commits does the processor publish sync state,
  notify sessions, and resume backend pushing. A known-payload decode failure,
  materializer evaluation/hash failure, or SQLite mutation failure wraps the
  failing canonical event and last-valid head in a structured poisoned-event
  diagnostic. The pull worker does not retry the unchanged event, backend
  pushing remains fenced, and Store lifecycle supervision shuts the Store down
  regardless of `onSyncError: 'ignore'` (LS.SYS.SYNC.PROC-R05/R06).
- **Pull precedence** (`:241, 393, 408-438`): a 1-permit semaphore
  (`localPushBackendPullMutex`) makes local-push application and pull-chunk
  application mutually exclusive; the pull side holds the permit for a
  whole chunk, so a rebase can never interleave a local-push apply.
- **Materialization** (`:849-886`): `materializeEventsBatch` opens one
  transaction on `dbState` and one on `dbEventlog` in lockstep, commits
  them sequentially inside one uninterruptible effect with a joint
  rollback finalizer. This protects against interruption and errors, but
  is **not crash-atomic across the two databases**: a process death
  between the two COMMITs can diverge state from eventlog (healed only by
  state rebuild when the state DB is absent — see
  `../../02-state/01-sqlite/`). Local push acknowledgements are completed only
  after the batch is materialized, published in leader sync state, offered to
  session pull queues, and queued for backend propagation.
- **Boot** (`:684-755`): initial sync state rehydrates from the eventlog
  (`../../04-runtime/spec.md` Leadership Handover); error routing via
  `onError: ignore|shutdown` and `BackendIdMismatchError` handling
  (`reset|shutdown|ignore`; reset clears local databases, `:1060-1123`).
  Generic ignored failures may be logged without shutting down, but a poisoned
  canonical event is never ignored: it is a terminal supervised lifecycle
  failure so no Store remains apparently healthy with dead sync workers.

## Client Session Sync Processor

`sync/ClientSessionSyncProcessor.ts`. One unbounded STM `leaderPushQueue`
(`:104`) decouples `push()` (synchronous commit path) from leader I/O:

- **Push** (`:454-456`): synchronously merge into local sync state and enqueue
  the merge's `newEvents` without waiting for pull/rebase ownership; a background fiber drains
  `takeBetween(1, leaderPushBatchSize)` and pushes to the leader (`:153-168`).
  Coalescing is opportunistic (whatever accumulated while the previous
  push was in flight); there is no time-based debounce. A rejected push
  records the unresolved batch, clears the queue, and parks the sole worker.
  Later commits remain synchronous and accumulate in pending/the FIFO without
  crossing the boundary. Pull recovery atomically reseeds the FIFO from live
  pending and restarts the worker. Rejection transition setup serializes with
  pull so a late response cannot install a fence after that pull already
  recovered the batch (resolved
  [DELTA-001](./.delta/DELTA-001-session-rejection-prefix-bypass.md)).
- **Pull** (`:145-168, 226-253`): a lazily-restarted stream from the
  leader (cursor = current `upstreamHead`) feeds `SyncState.merge`; a
  `reject` from upstream is impossible and dies (`:162-165`). New events
  re-materialize into the session DB with changesets and session-side
  materializer hashes written back, then `refreshTables` runs once per
  merge (`:232-250`).
- **Rebase critical section** (`:209-272`): interrupt the push fiber → roll
  back session changesets in reverse order (`meta.sessionChangeset`, then mark
  `unset`) → **atomically reconcile** the push queue (clear + re-offer the
  _live_ `syncStateRef.current.pending` inside one `Effect.tx`, with no async
  park between the read, clear, and offer) → restart the push fiber. Re-reading
  the live pending (rather than the stale merge-time snapshot) is what
  serializes `push` against rebase **without blocking it**: `push` runs via
  `Effect.runSyncWith` as an indivisible unit that can only interleave in the
  pull fiber's async gaps, so a synchronous commit admitted during a rebase
  park is folded into the reconciliation instead of being torn away by the
  clear. This replaces the earlier design where `push` acquired the pull-
  reconciliation mutex, which violated the synchronous-commit invariant
  (LS.SYS.STORE-R09) by suspending the commit path (see `.decisions/`, #1465). Deterministic
  `rebaseBarriers` hooks at 3 labeled points let tests inject a concurrent
  push/shutdown into this window (the F1 no-loss oracle).
- **Shutdown drain:** orderly shutdown closes new `push()` admission, stops
  pull processing while holding the state-ownership permit (which still
  serializes shutdown↔rebase — only `push` was taken off that permit), ends the
  push queue, and awaits its sole worker. Success therefore means all admitted
  events reached the leader; an unresolved rejection or fatal push fails the
  drain. Failed shutdown interrupts the pull and push workers. The Store runs
  this cleanup detached under a **hard bound**: the caller stops waiting after
  1s, and the detached drain is itself force-closed after
  `SHUTDOWN_DRAIN_HARD_TIMEOUT_MS` so an unresponsive leader cannot leak the
  lifetime scope (LS.SYS.SYNC.PROC-R03, LS.SYS.STORE-R07).
- **Observability** (`:98-99, 358-361`): sync-state updates surface via a
  separate queue explicitly not relied on for correctness; a devtools
  latch can pause upstream application (`:152-153`).

## Backpressure and Known Gaps

- All processor queues are unbounded; there is no producer backpressure.
  Anti-thrash relies on interrupt/clear on rebase and queue-clear on
  rejection.
- `cachedPayloads` in the leader's session pull path can grow without
  bound (TODO, `LeaderSyncProcessor.ts:912-913`; issue #1423).
- Per-event `materializerHashLeader` beyond the first item of a pull chunk
  is unknown (TODO, `:555-556`, issue #503).
- Metrics for retry/queue health are an acknowledged TODO (`:599`).
