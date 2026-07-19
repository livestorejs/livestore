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
  `validatePushBatch` (`:1024-1054`) requires strictly ascending batches
  (`NonMonotonicBatchError`) whose first event is ahead of
  `pushHeadRef.current` (`LeaderAheadError`); `pushHead` advances on push
  and on every pull merge (`:648, 521`).
- **Generations** (`:271-296, 321-366`): each queued item carries its
  seqNum's `rebaseGeneration`. After acquiring the mutex, items with a
  stale generation are dropped and their deferreds failed with
  `StaleRebaseGenerationError`. A merge `reject` fails the batch's
  deferreds with `LeaderAheadError`, bumps the generation, and drains
  same-generation queued items — sessions rebase and re-push.
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
  `../../02-state/01-sqlite/`).
- **Boot** (`:684-755`): initial sync state rehydrates from the eventlog
  (`../../04-runtime/spec.md` Leadership Handover); error routing via
  `onError: ignore|shutdown` and `BackendIdMismatchError` handling
  (`reset|shutdown|ignore`; reset clears local databases, `:1060-1123`).

## Client Session Sync Processor

`sync/ClientSessionSyncProcessor.ts`. One unbounded STM `leaderPushQueue`
(`:104`) decouples `push()` (synchronous commit path) from leader I/O:

- **Push** (`:341-343`): synchronously merge into local sync state and enqueue
  the merge's `newEvents` without waiting for pull/rebase ownership; a background fiber drains
  `takeBetween(1, leaderPushBatchSize)` and pushes to the leader (`:128-129`).
  Coalescing is opportunistic (whatever accumulated while the previous
  push was in flight); there is no time-based debounce. A rejected push
  clears the whole queue (`:130-133`) — events are re-derived from the
  next pull.
- **Pull** (`:145-168, 226-253`): a lazily-restarted stream from the
  leader (cursor = current `upstreamHead`) feeds `SyncState.merge`; a
  `reject` from upstream is impossible and dies (`:162-165`). New events
  re-materialize into the session DB with changesets and session-side
  materializer hashes written back, then `refreshTables` runs once per
  merge (`:232-250`).
- **Rebase critical section** (`:170-214`): interrupt the push fiber →
  clear the queue → roll back session changesets in reverse order
  (`meta.sessionChangeset`, then mark `unset`) → re-offer rebased pending
  → restart the push fiber. Sequencing is what the built-in simulation
  harness perturbs (`simSleep` hooks at 5 labeled points, `:83-86,
414-422`; `SIMULATION_ENABLED` is hardcoded `true` with a build-macro
  TODO, `:410-411`).
- **Shutdown drain:** orderly shutdown closes new `push()` admission, stops
  pull processing while holding the same state-ownership permit, ends the push
  queue, and awaits its sole worker. Success therefore means all admitted
  events reached the leader; an unresolved rejection or fatal push fails the
  drain. Failed shutdown interrupts the pull and push workers. Store-level
  timeout stops waiting without cancelling this cleanup
  (LS.SYS.SYNC.PROC-R03).
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
