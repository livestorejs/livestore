import { shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Scope } from '@livestore/utils/effect'
import {
  Chunk,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Option,
  OtelTracer,
  Queue,
  Ref,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { EventId, SynchronousDatabase } from '../adapter-types.js'
import { compareEventIds, ROOT_ID, UnexpectedError } from '../adapter-types.js'
import * as Devtools from '../devtools/index.js'
import type { LiveStoreSchema, MutationEvent, SessionChangesetMetaRow } from '../schema/index.js'
import {
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
  SYNC_STATUS_TABLE,
} from '../schema/index.js'
import { updateRows } from '../sql-queries/index.js'
import { InvalidPushError } from '../sync/sync.js'
import * as SyncState from '../sync/syncstate.js'
import { MutationEventEncodedWithDeferred, nextEventIdPair } from '../sync/syncstate.js'
import { sql } from '../util.js'
import { liveStoreVersion } from '../version.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import { getBackendHeadFromDb, getLocalHeadFromDb, getMutationEventsSince, updateBackendHead } from './mutationlog.js'
import type { InitialBlockingSyncContext, InitialSyncInfo, SyncProcessor } from './types.js'
import { LeaderThreadCtx } from './types.js'

const isEqualEvent = (a: MutationEvent.AnyEncoded, b: MutationEvent.AnyEncoded) =>
  a.id.global === b.id.global &&
  a.id.local === b.id.local &&
  a.mutation === b.mutation &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)

// const whenTraceVerbose = <T>(object: T) => TRACE_VERBOSE ? object : undefined

/*
New implementation idea: Model the sync thing as a state machine.

External events:
- Mutation pushed from client session
- Mutation pushed from devtools (via pushPartial)
- Mutation pulled from sync backend

The machine can be in the following states:
- in-sync: fully synced with remote, now idling
- applying-syncstate-advance (with pointer to current progress in case of rebase interrupt)

Transitions:
- in-sync -> applying-syncstate-advance
- applying-syncstate-advance -> in-sync
- applying-syncstate-advance -> applying-syncstate-advance (need to interrupt previous operation)

Queuing vs interrupting behaviour:
- Operations caused by pull can never be interrupted
- Incoming pull can interrupt current push
- Incoming pull needs to wait to previous pull to finish
- Incoming push needs to wait to previous push to finish

Backend pushing:
- continously push to backend
- only interrupted and restarted on rebase

Open questions:
- Which things can be done synchronously vs which are inherently async vs which need to be sliced up?
  - Synchronous:
    - Mutation pushed from client session
    - non-interactive rebase
    - rolling back and applying a short log of events (limit needs to be configurable)
  - Asynchronous:
    - interactive rebase
  - with loading spinner: (only on main thread)
    - rolling back + applying a long log of events
    - interactive rebase
- Which things are allowed concurrently vs which not?
- Is there anything that's not interruptible?
  - interactive rebase

*/

type ProcessorStateInit = {
  _tag: 'init'
}

type ProcessorStateInSync = {
  _tag: 'in-sync'
  syncState: SyncState.SyncState
}

type ProcessorStateApplyingSyncStateAdvance = {
  _tag: 'applying-syncstate-advance'
  origin: 'pull' | 'push'
  syncState: SyncState.SyncState
  // TODO re-introduce this
  // proccesHead: EventId
  fiber: Fiber.RuntimeFiber<void, UnexpectedError>
}

type ProcessorState = ProcessorStateInit | ProcessorStateInSync | ProcessorStateApplyingSyncStateAdvance

/**
 * The general idea of the sync processor is to "follow the sync state"
 * and apply/rollback mutations as needed to the read model and mutation log.
 * The leader sync processor is also responsible for
 * - broadcasting mutations to client sessions via the pull queues.
 * - pushing mutations to the sync backend
 *
 * In the leader sync processor, pulling always has precedence over pushing.
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbMissing,
  dbLog,
  initialBlockingSyncContext,
}: {
  schema: LiveStoreSchema
  /** Only used to know whether we can safely query dbLog during setup execution */
  dbMissing: boolean
  dbLog: SynchronousDatabase
  initialBlockingSyncContext: InitialBlockingSyncContext
}): Effect.Effect<SyncProcessor, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>().pipe(
      Effect.acquireRelease(Queue.shutdown),
    )

    /** State transitions need to happen atomically, so we use a Ref to track the state */
    const stateRef = yield* Ref.make<ProcessorState>({ _tag: 'init' })

    const semaphore = yield* Effect.makeSemaphore(1)

    // const mutex = yield*

    const isLocalEvent = (mutationEventEncoded: MutationEventEncodedWithDeferred) => {
      const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
      return mutationDef.options.localOnly
    }

    const spanRef = { current: undefined as otel.Span | undefined }
    const applyMutationItemsRef = { current: undefined as ApplyMutationItems | undefined }

    const push = (newEvents: ReadonlyArray<MutationEventEncodedWithDeferred>) =>
      Effect.gen(function* () {
        // TODO validate batch
        if (newEvents.length === 0) return

        const { connectedClientSessionPullQueues } = yield* LeaderThreadCtx

        // Wait for the state to be in-sync
        const state = yield* Ref.get(stateRef)
        if (state._tag !== 'in-sync') {
          yield* semaphore.take(1)
        }

        if (state._tag === 'init') return shouldNeverHappen('Not initialized')

        const updateResult = SyncState.updateSyncState({
          syncState: state.syncState,
          payload: { _tag: 'local-push', newEvents },
          isLocalEvent,
          isEqualEvent,
        })

        if (updateResult._tag === 'rebase') {
          return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
        } else if (updateResult._tag === 'reject') {
          return yield* Effect.fail(
            InvalidPushError.make({
              reason: {
                _tag: 'LeaderAhead',
                minimumExpectedId: updateResult.expectedMinimumId,
                providedId: newEvents.at(0)!.id,
              },
            }),
          )
        }

        const fiber = yield* applyMutationItemsRef.current!({ batchItems: updateResult.newEvents }).pipe(Effect.fork)

        yield* Ref.set(stateRef, {
          _tag: 'applying-syncstate-advance',
          origin: 'push',
          syncState: updateResult.syncState,
          fiber,
        })

        yield* connectedClientSessionPullQueues.offer({
          payload: { _tag: 'upstream-advance', newEvents: updateResult.newEvents },
          remaining: 0,
        })

        spanRef.current?.addEvent('local-push', {
          batchSize: newEvents.length,
          updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
        })

        // Don't sync localOnly mutations
        const filteredBatch = updateResult.newEvents.filter((mutationEventEncoded) => {
          const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
          return mutationDef.options.localOnly === false
        })

        yield* syncBackendQueue.offerAll(filteredBatch)

        yield* fiber // Waiting for the mutation to be applied
      }).pipe(
        Effect.withSpan('@livestore/common:leader-thread:syncing:local-push', {
          attributes: {
            batchSize: newEvents.length,
            batch: TRACE_VERBOSE ? newEvents : undefined,
          },
          links: spanRef.current
            ? [{ _tag: 'SpanLink', span: OtelTracer.makeExternalSpan(spanRef.current.spanContext()), attributes: {} }]
            : undefined,
        }),
      )

    const pushPartial: SyncProcessor['pushPartial'] = (mutationEventEncoded_) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)
        if (state._tag === 'init') return shouldNeverHappen('Not initialized')

        const mutationDef =
          schema.mutations.get(mutationEventEncoded_.mutation) ??
          shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded_.mutation}`)

        const mutationEventEncoded = new MutationEventEncodedWithDeferred({
          ...mutationEventEncoded_,
          ...nextEventIdPair(state.syncState.localHead, mutationDef.options.localOnly),
        })

        yield* push([mutationEventEncoded])
      }).pipe(Effect.catchTag('InvalidPushError', Effect.orDie))

    // Starts various background loops
    const boot: SyncProcessor['boot'] = ({ dbReady }) =>
      Effect.gen(function* () {
        const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        spanRef.current = span

        const initialBackendHead = dbMissing ? ROOT_ID.global : getBackendHeadFromDb(dbLog)
        const initialLocalHead = dbMissing ? ROOT_ID : getLocalHeadFromDb(dbLog)

        if (initialBackendHead > initialLocalHead.global) {
          return shouldNeverHappen(
            `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
          )
        }

        const pendingMutationEvents = yield* getMutationEventsSince({ global: initialBackendHead, local: 0 })

        const initialSyncState = {
          pending: pendingMutationEvents.map((_) => new MutationEventEncodedWithDeferred(_)),
          // On the leader we don't need a rollback tail beyond `pending` items
          rollbackTail: [],
          upstreamHead: { global: initialBackendHead, local: 0 },
          localHead: initialLocalHead,
        } as SyncState.SyncState

        /** State transitions need to happen atomically, so we use a Ref to track the state */
        yield* Ref.set(stateRef, { _tag: 'in-sync', syncState: initialSyncState })

        applyMutationItemsRef.current = yield* makeApplyMutationItems({ stateRef, semaphore })

        // Rehydrate sync queue
        if (pendingMutationEvents.length > 0) {
          const filteredBatch = pendingMutationEvents
            // Don't sync localOnly mutations
            .filter((mutationEventEncoded) => {
              const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
              return mutationDef.options.localOnly === false
            })

          yield* syncBackendQueue.offerAll(filteredBatch)
        }

        const backendPushingFiberHandle = yield* FiberHandle.make()

        yield* FiberHandle.run(
          backendPushingFiberHandle,
          backgroundBackendPushing({ dbReady, syncBackendQueue, span }).pipe(Effect.tapCauseLogPretty),
        )

        yield* backgroundBackendPulling({
          dbReady,
          initialBackendHead,
          isLocalEvent,
          restartBackendPushing: Effect.gen(function* () {
            yield* FiberHandle.clear(backendPushingFiberHandle)
            // Reset the sync queue
            yield* Queue.takeAll(syncBackendQueue)
            const state = yield* Ref.get(stateRef)
            if (state._tag === 'init') return shouldNeverHappen('Not initialized')

            const filteredPending = state.syncState.pending.filter((mutationEvent) => {
              const mutationDef = schema.mutations.get(mutationEvent.mutation)!
              return mutationDef.options.localOnly === false
            })

            // TODO use bucket queue to gurantee batching
            yield* syncBackendQueue.offerAll(filteredPending)

            yield* FiberHandle.run(
              backendPushingFiberHandle,
              backgroundBackendPushing({ dbReady, syncBackendQueue, span }).pipe(Effect.tapCauseLogPretty),
            )
          }),
          applyMutationItemsRef,
          stateRef,
          syncBackendQueue,
          semaphore,
          span,
          initialBlockingSyncContext,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }).pipe(
        // TODO remove timeout
        // Effect.andThen(Effect.never),
        // Effect.timeout(2000),
        // Effect.orDie,
        // Effect.withSpan('@livestore/common:leader-thread:syncing'),
        // Effect.forkScoped,
        Effect.withSpanScoped('@livestore/common:leader-thread:syncing'),
      )

    return {
      push,
      pushPartial,
      boot,
      syncState: Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)
        if (state._tag === 'init') return shouldNeverHappen('Not initialized')
        return state.syncState
      }),
    } satisfies SyncProcessor
  })

type ApplyMutationItems = (_: {
  batchItems: ReadonlyArray<MutationEventEncodedWithDeferred>
}) => Effect.Effect<void, UnexpectedError>

// TODO how to handle errors gracefully
const makeApplyMutationItems = ({
  stateRef,
  semaphore,
}: {
  stateRef: Ref.Ref<ProcessorState>
  semaphore: Effect.Semaphore
}): Effect.Effect<ApplyMutationItems, UnexpectedError, LeaderThreadCtx | Scope.Scope> =>
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { db, dbLog } = leaderThreadCtx

    const applyMutation = yield* makeApplyMutation

    return ({ batchItems }) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)
        if (state._tag !== 'applying-syncstate-advance') {
          return shouldNeverHappen(`Expected to be applying-syncstate-advance but got ${state._tag}`)
        }

        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        yield* Effect.addFinalizer((exit) =>
          Effect.gen(function* () {
            if (Exit.isSuccess(exit)) return

            // Rollback in case of an error
            db.execute('ROLLBACK', undefined)
            dbLog.execute('ROLLBACK', undefined)
          }),
        )

        for (let i = 0; i < batchItems.length; i++) {
          const { meta, ...mutationEventEncoded } = batchItems[i]!

          // persisted: item.persisted,
          yield* applyMutation(mutationEventEncoded, { persisted: true })

          if (leaderThreadCtx.devtools.enabled) {
            // TODO consider to refactor devtools to use syncing mechanism instead of devtools-specific broadcast channel
            yield* leaderThreadCtx.devtools
              .broadcast(Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted: true, liveStoreVersion }))
              .pipe(Effect.fork) // Forking right now as it otherwise slows down the processing
          }

          if (meta?.deferred) {
            yield* Deferred.succeed(meta.deferred, void 0)
          }

          // TODO re-introduce this
          // if (i < batchItems.length - 1) {
          //   yield* Ref.set(stateRef, { ...state, proccesHead: batchItems[i + 1]!.id })
          // }
        }

        db.execute('COMMIT', undefined) // Commit the transaction
        dbLog.execute('COMMIT', undefined) // Commit the transaction

        yield* Ref.set(stateRef, { _tag: 'in-sync', syncState: state.syncState })
        yield* semaphore.release(1)
      }).pipe(
        Effect.scoped,
        Effect.withSpan('@livestore/common:leader-thread:syncing:applyMutationItems'),
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
      )
  })

const backgroundBackendPulling = ({
  dbReady,
  initialBackendHead,
  isLocalEvent,
  restartBackendPushing,
  span,
  stateRef,
  syncBackendQueue,
  applyMutationItemsRef,
  semaphore,
  initialBlockingSyncContext,
}: {
  dbReady: Deferred.Deferred<void>
  initialBackendHead: number
  isLocalEvent: (mutationEventEncoded: MutationEventEncodedWithDeferred) => boolean
  restartBackendPushing: Effect.Effect<void, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>
  span: otel.Span | undefined
  stateRef: Ref.Ref<ProcessorState>
  syncBackendQueue: Queue.Queue<MutationEvent.AnyEncoded>
  applyMutationItemsRef: { current: ApplyMutationItems | undefined }
  semaphore: Effect.Semaphore
  initialBlockingSyncContext: InitialBlockingSyncContext
}) =>
  Effect.gen(function* () {
    const { syncBackend, db, dbLog, connectedClientSessionPullQueues } = yield* LeaderThreadCtx

    if (syncBackend === undefined) return

    const cursorInfo = yield* getCursorInfo(initialBackendHead)

    const onNewPullChunk = (newEvents: MutationEventEncodedWithDeferred[], remaining: number) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        const state = yield* Ref.get(stateRef)
        if (state._tag === 'init') return shouldNeverHappen('Not initialized')

        if (state._tag === 'applying-syncstate-advance') {
          if (state.origin === 'push') {
            yield* Fiber.interrupt(state.fiber)
            // In theory we should force-take the semaphore here, but as it's still taken,
            // it's already in the right state we want it to be in
          } else {
            // Wait for previous advance to finish
            yield* semaphore.take(1)
          }
        }

        const trimRollbackUntil = newEvents.at(-1)!.id

        const updateResult = SyncState.updateSyncState({
          syncState: state.syncState,
          payload: { _tag: 'upstream-advance', newEvents, trimRollbackUntil },
          isLocalEvent,
          isEqualEvent,
          ignoreLocalEvents: true,
        })

        if (updateResult._tag === 'reject') {
          return shouldNeverHappen('The leader thread should never reject upstream advances')
        }

        const newBackendHead = newEvents.at(-1)!.id

        updateBackendHead(dbLog, newBackendHead)

        if (updateResult._tag === 'rebase') {
          span?.addEvent('backend-pull:rebase', {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
            rollbackCount: updateResult.eventsToRollback.length,
            updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
          })

          yield* restartBackendPushing

          if (updateResult.eventsToRollback.length > 0) {
            yield* rollback({ db, dbLog, eventIdsToRollback: updateResult.eventsToRollback.map((_) => _.id) })
          }

          yield* connectedClientSessionPullQueues.offer({
            payload: {
              _tag: 'upstream-rebase',
              newEvents: updateResult.newEvents,
              rollbackUntil: updateResult.eventsToRollback.at(-1)!.id,
              trimRollbackUntil,
            },
            remaining,
          })

          yield* Queue.offerAll(syncBackendQueue, updateResult.syncState.pending)
        } else {
          span?.addEvent('backend-pull:advance', {
            newEventsCount: newEvents.length,
            updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
          })

          yield* connectedClientSessionPullQueues.offer({
            payload: { _tag: 'upstream-advance', newEvents: updateResult.newEvents, trimRollbackUntil },
            remaining,
          })
        }

        const fiber = yield* applyMutationItemsRef.current!({ batchItems: updateResult.newEvents }).pipe(Effect.fork)

        yield* Ref.set(stateRef, {
          _tag: 'applying-syncstate-advance',
          origin: 'pull',
          syncState: updateResult.syncState,
          fiber,
        })
      })

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ batch, remaining }) =>
        Effect.gen(function* () {
          // yield* Effect.spanEvent('batch', {
          //   attributes: {
          //     batchSize: batch.length,
          //     batch: TRACE_VERBOSE ? batch : undefined,
          //   },
          // })

          // Wait for the db to be initially created
          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // TODO pass in metadata
          yield* onNewPullChunk(
            batch.map((_) => new MutationEventEncodedWithDeferred(_.mutationEventEncoded)),
            remaining,
          )

          yield* initialBlockingSyncContext.update({ processed: batch.length, remaining })
        }),
      ),
      Stream.runDrain,
      Effect.interruptible,
    )
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:syncing:backend-pulling'))

const rollback = ({
  db,
  dbLog,
  eventIdsToRollback,
}: {
  db: SynchronousDatabase
  dbLog: SynchronousDatabase
  eventIdsToRollback: EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = db
      .select<SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, local: _.idLocal }, changeset: _.changeset, debug: _.debug }))
      .toSorted((a, b) => compareEventIds(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      db.makeChangeset(changeset).invert().apply()
    }

    // Delete the changeset rows
    db.execute(
      sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
    )

    // Delete the mutation log rows
    dbLog.execute(
      sql`DELETE FROM ${MUTATION_LOG_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
    )
  }).pipe(
    Effect.withSpan('@livestore/common:leader-thread:syncing:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )

const getCursorInfo = (remoteHead: number) =>
  Effect.gen(function* () {
    const { dbLog } = yield* LeaderThreadCtx

    if (remoteHead === ROOT_ID.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idLocal ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, local: 0 },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:syncing:getCursorInfo', { attributes: { remoteHead } }))

const backgroundBackendPushing = ({
  dbReady,
  syncBackendQueue,
  span,
}: {
  dbReady: Deferred.Deferred<void>
  syncBackendQueue: Queue.Queue<MutationEvent.AnyEncoded>
  span: otel.Span | undefined
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbLog } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* dbReady

    while (true) {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO make batch size configurable
      const queueItems = yield* syncBackendQueue.takeBetween(1, 50).pipe(Effect.map(Chunk.toReadonlyArray))

      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      span?.addEvent('backend-push', {
        batchSize: queueItems.length,
        batch: TRACE_VERBOSE ? JSON.stringify(queueItems) : undefined,
      })

      // TODO handle push errors (should only happen during concurrent pull+push)
      const pushResult = yield* syncBackend.push(queueItems, true).pipe(Effect.either)

      if (pushResult._tag === 'Left') {
        span?.addEvent('backend-push-error', { error: pushResult.left.toString() })
        // wait for interrupt and restarting of pushing
        return yield* Effect.never
      }

      const { metadata } = pushResult.right

      // TODO try to do this in a single query
      for (let i = 0; i < queueItems.length; i++) {
        const mutationEventEncoded = queueItems[i]!
        yield* execSql(
          dbLog,
          ...updateRows({
            tableName: MUTATION_LOG_META_TABLE,
            columns: mutationLogMetaTable.sqliteDef.columns,
            where: { idGlobal: mutationEventEncoded.id.global, idLocal: mutationEventEncoded.id.local },
            updateValues: { syncMetadataJson: metadata[i]! },
          }),
        )
      }
    }
  }).pipe(Effect.interruptible, Effect.withSpan('@livestore/common:leader-thread:syncing:backend-pushing'))
