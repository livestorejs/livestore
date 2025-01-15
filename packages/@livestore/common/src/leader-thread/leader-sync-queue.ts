import { env, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import {
  BucketQueue,
  Chunk,
  Deferred,
  Effect,
  Option,
  OtelTracer,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { EventId, SynchronousDatabase, UnexpectedError } from '../adapter-types.js'
import { ROOT_ID } from '../adapter-types.js'
import * as Devtools from '../devtools/index.js'
import {
  type LiveStoreSchema,
  MUTATION_LOG_META_TABLE,
  type MutationEvent,
  mutationLogMetaTable,
  SYNC_STATUS_TABLE,
} from '../schema/index.js'
import { updateRows } from '../sql-queries/index.js'
import { makeNextMutationEventIdPair } from '../sync/next-mutation-event-id-pair.js'
import { SyncLog2 } from '../sync/synclog.js'
import { sql } from '../util.js'
import { liveStoreVersion } from '../version.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import {
  getInitialBackendHeadFromDb,
  getInitialCurrentMutationEventIdFromDb,
  getMutationEventsSince,
} from './mutationlog.js'
import type { InitialSyncInfo, SyncQueue } from './types.js'
import { LeaderThreadCtx, MutationEventEncodedWithDeferred } from './types.js'
import { validateAndUpdateLocalHead } from './validateAndUpdateLocalHead.js'

const isEqualEvent = (a: MutationEvent.AnyEncoded, b: MutationEvent.AnyEncoded) =>
  a.id.global === b.id.global &&
  a.id.local === b.id.local &&
  a.mutation === b.mutation &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)

const TRACE_VERBOSE = env('LS_TRACE_VERBOSE') !== undefined
// const whenTraceVerbose = <T>(object: T) => TRACE_VERBOSE ? object : undefined

// type MutationEventWithDeferred = MutationEvent.AnyEncoded & { deferred?: Deferred.Deferred<void> }

/**
 * The sync queue represents the "tail" of the mutation log i.e. events that haven't been pushed yet.
 *
 * Mutation Log visualization:
 *
 * ```
 *                    Remote Head         Local Head
 *                         ▼                   ▼
 *   [-1]->[0]->[1]->[2]->[3]->[4]->[5]->[6]->[7]
 *  (Root)                      └─ Sync Queue ─┘
 *                              (unpushed events)
 * ```
 *
 * - Events Root-3: Already pushed/confirmed events (Remote Head at 3)
 * - Events 4-6: Events in push queue (not yet pushed/confirmed)
 */
export const makeSyncQueue = ({
  schema,
  dbMissing,
  dbLog,
}: {
  schema: LiveStoreSchema
  /** Only used to know whether we can safely query dbLog during setup execution */
  dbMissing: boolean
  dbLog: SynchronousDatabase
}): Effect.Effect<SyncQueue, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    // const pendingSyncItems: SyncQueueItem[] = []

    const executeQueue = yield* BucketQueue.make<MutationEventEncodedWithDeferred>()

    const syncBackendQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>().pipe(
      Effect.acquireRelease(Queue.shutdown),
    )

    // const syncQueueSemaphore = yield* Effect.makeSemaphore(1)
    // const syncQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>()

    // const isNotRebasingLatch = yield* Effect.makeLatch(false)

    const initialBackendHead = dbMissing ? ROOT_ID.global : getInitialBackendHeadFromDb(dbLog)

    // const localHeadRef = {
    //   // In the case where the db is missing, querying it will fail, so we safely use ROOT_ID
    //   current: dbMissing ? ROOT_ID : getInitialCurrentMutationEventIdFromDb(dbLog),
    // }
    // const nextMutationEventIdPair = makeNextMutationEventIdPair(localHeadRef)

    const syncLogStateRef = {
      current: {
        pending: [],
        rollbackTail: [],
        upstreamHead: { global: dbMissing ? ROOT_ID.global : getInitialBackendHeadFromDb(dbLog), local: 0 },
      } as SyncLog2.SyncLogState<MutationEventEncodedWithDeferred>,
    }

    const isLocalEvent = (mutationEventEncoded: MutationEvent.AnyEncoded) => {
      const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
      return mutationDef.options.localOnly
    }

    const spanRef = { current: undefined as otel.Span | undefined }

    // In case of leader thread:
    // For mutation event coming from client session, we want to ...
    // - reject if it's behind, and wait for it to pull + rebase itself
    // - broadcast to other connected client sessions
    // - write to mutation log + apply to read model
    // - push to sync backend
    const push = (batch: ReadonlyArray<MutationEventEncodedWithDeferred>) =>
      Effect.gen(function* () {
        if (batch.length === 0) return

        // TODO validate batch

        const res = SyncLog2.updateSyncLog2<MutationEventEncodedWithDeferred>({
          syncLog: syncLogStateRef.current,
          update: { _tag: 'local-push', newEvents: batch },
          isLocalEvent,
          isEqualEvent,
          rebase: ({ event, id, parentId }) => new MutationEventEncodedWithDeferred({ ...event, id, parentId }),
        })

        spanRef.current?.addEvent('push', {
          batchSize: batch.length,
          res: TRACE_VERBOSE ? JSON.stringify(res) : undefined,
        })

        const filteredBatch = res.newEvents

        syncLogStateRef.current = res.syncLog

        if (res._tag === 'rebase') {
          throw new Error('TODO: implement rebase in leader-thread for push')
        }

        // Don't sync localOnly mutations
        const filteredBatch_ = filteredBatch.filter((mutationEventEncoded) => {
          const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
          return mutationDef.options.localOnly === false
        })

        // pendingSyncItems.push(...filteredBatch)

        // TODO handle rebase

        // TODO reject mutation events that are behind current mutation event id
        // for (const { mutationEventEncoded } of batch) {
        // yield* validateAndUpdateLocalHead({
        //   // localHeadRef,
        //   mutationEventId: mutationEventEncoded.id,
        //   debugContext: { label: `leader-worker:applyMutation`, mutationEventEncoded },
        // })
        // }

        yield* syncBackendQueue.offerAll(filteredBatch_)

        // TODO clean up implementation (currently using `batch` as the event ids aren't used in this code path)
        yield* BucketQueue.offerAll(executeQueue, filteredBatch)
      }).pipe(
        Effect.withSpan('@livestore/common:leader-thread:syncing:push', {
          attributes: {
            batchSize: batch.length,
            batch: TRACE_VERBOSE ? batch : undefined,
          },
        }),
      )

    const pushPartial: SyncQueue['pushPartial'] = (mutationEventEncoded_) =>
      Effect.gen(function* () {
        // TODO bring back
        const mutationDef =
          schema.mutations.get(mutationEventEncoded_.mutation) ??
          shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded_.mutation}`)

        // const mutationEventEncoded = {
        //   ...mutationEventEncoded_,
        //   ...nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly }),
        // }

        // yield* push([{ mutationEventEncoded }])
      })

    // Starts various background loops
    const boot: SyncQueue['boot'] = ({ dbReady }) =>
      Effect.gen(function* () {
        const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
        spanRef.current = span

        {
          // rehydrate pushQueue from dbLog
          const pendingMutationEvents = yield* getMutationEventsSince({ global: initialBackendHead, local: 0 })

          if (pendingMutationEvents.length > 0) {
            const filteredBatch = pendingMutationEvents
              // Don't sync localOnly mutations
              .filter((mutationEventEncoded) => {
                const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
                return mutationDef.options.localOnly === false
              })

            // pendingSyncItems.push(...filteredBatch.map((_) => ({ mutationEventEncoded: _ })))

            syncLogStateRef.current = {
              ...syncLogStateRef.current,
              pending: filteredBatch.map((_) => new MutationEventEncodedWithDeferred(_)),
            }

            yield* syncBackendQueue.offerAll(filteredBatch)
          }
        }

        yield* executeMutationsLoop({ executeQueue, syncLogStateRef })

        yield* backgroundBackendPushing({ dbReady, syncBackendQueue })

        return yield* backgroundBackendPulling({
          dbReady,
          initialBackendHead,
          // localHeadRef,
          isLocalEvent,
          syncLogStateRef,
          executeQueue,
          span,
          // pendingSyncItems,
        })
      }).pipe(Effect.withSpanScoped('@livestore/common:leader-thread:syncing'))

    return { push, pushPartial, boot } satisfies SyncQueue
  })

const executeMutationsLoop = ({
  executeQueue,
  syncLogStateRef,
}: {
  executeQueue: BucketQueue.BucketQueue<MutationEventEncodedWithDeferred>
  syncLogStateRef: { current: SyncLog2.SyncLogState<MutationEventEncodedWithDeferred> }
}) =>
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { db, dbLog } = leaderThreadCtx

    const applyMutation = yield* makeApplyMutation

    yield* Effect.gen(function* () {
      const batchItems = yield* BucketQueue.takeBetween(executeQueue, 1, 50)

      try {
        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        // Now we're sending the mutation event to all "pulling" client sessions
        for (const queue of leaderThreadCtx.connectedClientSessionPullQueues) {
          // TODO do batching if possible
          // TODO remove backendHead
          yield* Queue.offer(queue, { mutationEvents: batchItems, backendHead: -1, remaining: 0 })
        }

        for (const { meta, ...mutationEventEncoded } of batchItems) {
          // if (item._tag === 'mutate') {
          // const mutationDef =
          //   schema.mutations.get(mutationEventEncoded.mutation) ??
          //   shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

          // persisted: item.persisted,
          yield* applyMutation(mutationEventEncoded, { persisted: true })

          if (leaderThreadCtx.devtools.enabled) {
            // TODO consider to refactor devtools to use syncing mechanism instead of devtools-specific broadcast channel
            yield* leaderThreadCtx.devtools.broadcast(
              Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted: true, liveStoreVersion }),
            )
          }

          if (meta.deferred) {
            yield* Deferred.succeed(meta.deferred, void 0)
          }

          // syncLogStateRef.current = {
          //   ...syncLogStateRef.current,
          //   pending: syncLogStateRef.current.pending.slice(1),
          // }
        }

        db.execute('COMMIT', undefined) // Commit the transaction
        dbLog.execute('COMMIT', undefined) // Commit the transaction
      } catch (error) {
        try {
          db.execute('ROLLBACK', undefined) // Rollback in case of an error
          dbLog.execute('ROLLBACK', undefined) // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)
  }).pipe(Effect.withSpanScoped('@livestore/common:leader-thread:syncing:executeMutationsLoop'))

const backgroundBackendPulling = ({
  dbReady,
  initialBackendHead,
  // localHeadRef,
  syncLogStateRef,
  isLocalEvent,
  executeQueue,
  // pendingSyncItems,
  span,
}: {
  dbReady: Deferred.Deferred<void>
  initialBackendHead: number
  // localHeadRef: { current: EventId }
  syncLogStateRef: { current: SyncLog2.SyncLogState<MutationEventEncodedWithDeferred> }
  isLocalEvent: (mutationEventEncoded: MutationEvent.AnyEncoded) => boolean
  executeQueue: BucketQueue.BucketQueue<MutationEventEncodedWithDeferred>
  // pendingSyncItems: SyncQueueItem[]
  span: otel.Span
}) =>
  Effect.gen(function* () {
    const { syncBackend, bootStatusQueue, dbLog, initialSyncOptions } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    const cursorInfo = yield* getCursorInfo(initialBackendHead)

    const initialSyncContext = {
      blockingDeferred: initialSyncOptions._tag === 'Blocking' ? yield* Deferred.make<void>() : undefined,
      isDone: false,
      processedMutations: 0,
      total: -1,
    }

    if (initialSyncContext.blockingDeferred !== undefined && initialSyncOptions._tag === 'Blocking') {
      yield* Deferred.succeed(initialSyncContext.blockingDeferred, void 0).pipe(
        Effect.delay(initialSyncOptions.timeout),
        Effect.forkScoped,
      )
    }

    const onNewPullChunk = (chunk: MutationEventEncodedWithDeferred[]) =>
      Effect.gen(function* () {
        if (chunk.length === 0) return

        span.addEvent('pre-pull', {
          syncLogState: TRACE_VERBOSE ? JSON.stringify(syncLogStateRef.current) : undefined,
        })

        const res = SyncLog2.updateSyncLog2<MutationEventEncodedWithDeferred>({
          syncLog: syncLogStateRef.current,
          update: { _tag: 'upstream-advance', newEvents: chunk },
          isLocalEvent,
          isEqualEvent,
          rebase: ({ event, id, parentId }) => new MutationEventEncodedWithDeferred({ ...event, id, parentId }),
        })

        span.addEvent('pull', {
          chunkSize: chunk.length,
          res: TRACE_VERBOSE ? JSON.stringify(res) : undefined,
        })

        syncLogStateRef.current = res.syncLog

        // TODO either use `sessionId` to verify or introduce a new nanoid-field
        // const hasLocalPendingEvents = false

        // if (hasLocalPendingEvents) {
        //   const matchesPendingEvents = true

        //   if (matchesPendingEvents) {
        //     // apply chunk to read model
        //     // forward chunk to client sessions
        //     // remove from items
        //   } else {
        //     // rebase
        //     // yield* rebasePushQueue(chunk)
        //   }
        // } else {
        //   const filteredChunk: MutationEvent.AnyEncoded[] = []
        //   for (let i = 0; i < chunk.length; i++) {
        //     const localItem = pendingSyncItems[i]
        //     const pullItem = chunk[i]!
        //     if (localItem?.mutationEventEncoded.id.global === pullItem.id.global) {
        //       pendingSyncItems.splice(i, 1)
        //     } else {
        //       filteredChunk.push(pullItem)
        //     }
        //   }

        if (res._tag === 'rebase' && res.eventsToRollback.length > 0) {
          throw new Error('TODO: implement rebase in leader-thread')
        }

        const filteredChunk = res.newEvents

        // console.log('pull res', { filteredChunk, pendingSyncItems, chunk })

        const newBackendHead = filteredChunk.at(-1)!.id.global

        yield* execSql(dbLog, sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${newBackendHead}`, {}).pipe(Effect.orDie)

        // backendHeadRef.current = newBackendHead

        // if (localHeadRef.current.global < newBackendHead) {
        //   localHeadRef.current = { global: newBackendHead, local: 0 }
        // }

        yield* BucketQueue.offerAll(executeQueue, filteredChunk)
        // }
      })

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ batch, remaining }) =>
        Effect.gen(function* () {
          yield* Effect.spanEvent('batch', {
            attributes: {
              batchSize: batch.length,
              batch: TRACE_VERBOSE ? batch : undefined,
            },
          })

          // NOTE this is a temporary workaround until rebase-syncing is implemented
          // const batch = items_.filter(
          //   (_) => _.mutationEventEncoded.id.global > localHeadRef.current.global,
          // )

          if (initialSyncContext.total === -1) {
            initialSyncContext.total = remaining + batch.length
          }

          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          // TODO pass in metadata
          yield* onNewPullChunk(batch.map((_) => new MutationEventEncodedWithDeferred(_.mutationEventEncoded)))

          if (initialSyncContext.isDone === false) {
            initialSyncContext.processedMutations += batch.length
            yield* Queue.offer(bootStatusQueue, {
              stage: 'syncing',
              progress: { done: initialSyncContext.processedMutations, total: initialSyncContext.total },
            })
          }

          if (
            initialSyncContext.isDone === false &&
            remaining === 0 &&
            initialSyncContext.blockingDeferred !== undefined
          ) {
            yield* Deferred.succeed(initialSyncContext.blockingDeferred, void 0)
            initialSyncContext.isDone = true
          }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/common:leader-thread:syncing:pulling'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    return initialSyncContext.blockingDeferred
  })

const getCursorInfo = (remoteHead: number) =>
  Effect.gen(function* () {
    const { dbLog } = yield* LeaderThreadCtx

    if (remoteHead === ROOT_ID.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.headOrElse())

    const syncMetadataOption = yield* Effect.sync(() =>
      dbLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idLocal ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, local: 0 },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  })

const backgroundBackendPushing = ({
  dbReady,
  syncBackendQueue,
}: {
  dbReady: Deferred.Deferred<void>
  syncBackendQueue: Queue.Queue<MutationEvent.AnyEncoded>
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbLog } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* dbReady

    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

    // TODO also wait for pulling to be done

    // TODO make batch size configurable
    // TODO peek instead of take
    const queueItems = yield* syncBackendQueue.takeBetween(1, 50)

    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

    // TODO handle push errors (should only happen during concurrent pull+push)
    const { metadata } = yield* syncBackend.push(Chunk.toReadonlyArray(queueItems), true)

    // yield* execSql(
    //   dbLog,
    //   ...updateRows({
    //     tableName: SYNC_STATUS_TABLE,
    //     columns: syncStatusTable.sqliteDef.columns,
    //     where: {},
    //     updateValues: { head: Chunk.unsafeLast(queueItems)!.id.global },
    //   }),
    // )

    for (let i = 0; i < queueItems.length; i++) {
      const mutationEventEncoded = Chunk.unsafeGet(queueItems, i)
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
  }).pipe(
    Effect.forever,
    Effect.interruptible,
    Effect.withSpan('@livestore/common:leader-thread:syncing:pushing'),
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )
