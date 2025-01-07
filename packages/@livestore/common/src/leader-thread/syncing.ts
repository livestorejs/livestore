import { shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Chunk, Deferred, Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { ROOT_ID, type UnexpectedError } from '../adapter-types.js'
import * as Devtools from '../devtools/index.js'
import {
  type LiveStoreSchema,
  MUTATION_LOG_META_TABLE,
  type MutationEvent,
  mutationLogMetaTable,
  SYNC_STATUS_TABLE,
} from '../schema/index.js'
import { updateRows } from '../sql-queries/index.js'
import { prepareBindValues, sql } from '../util.js'
import { liveStoreVersion } from '../version.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import type { InitialSyncInfo, PushQueueItemLeader, PushQueueLeader } from './types.js'
import { LeaderThreadCtx } from './types.js'
import { validateAndUpdateMutationEventId } from './validateAndUpdateMutationEventId.js'

export const makePushQueueLeader = ({
  schema,
}: {
  schema: LiveStoreSchema
}): Effect.Effect<PushQueueLeader, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    // const localItems: PushQueueItemLeader[] = []

    const executeQueue = yield* Queue.unbounded<PushQueueItemLeader>().pipe(Effect.acquireRelease(Queue.shutdown))

    const syncQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>().pipe(Effect.acquireRelease(Queue.shutdown))

    // const syncPushQueueSemaphore = yield* Effect.makeSemaphore(1)
    // const syncPushQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>()

    // const isNotRebasingLatch = yield* Effect.makeLatch(false)

    const syncHeadRef = { current: 0 }

    const push = (batch: PushQueueItemLeader[]) =>
      Effect.gen(function* () {
        // localItems.push(...items)
        const { currentMutationEventIdRef } = yield* LeaderThreadCtx

        // TODO reject mutation events that are behind current mutation event id
        for (const { mutationEventEncoded } of batch) {
          yield* validateAndUpdateMutationEventId({
            currentMutationEventIdRef,
            mutationEventId: mutationEventEncoded.id,
            debugContext: { label: `leader-worker:applyMutation`, mutationEventEncoded },
          })
        }

        // TODO handle rebase
        yield* syncQueue.offerAll(
          batch
            .filter((item) => {
              const mutationDef = schema.mutations.get(item.mutationEventEncoded.mutation)!
              return mutationDef.options.localOnly === false
            })
            .map((item) => item.mutationEventEncoded),
        )

        // In case of leader thread:
        // For mutation event coming from client session, we want to ...
        // - reject if it's behind, and wait for it to pull + rebase itself
        // - broadcast to other connected client sessions
        // - write to mutation log + apply to read model
        // - push to sync backend

        yield* executeQueue.offerAll(batch)
      })

    const initSyncing: PushQueueLeader['initSyncing'] = ({ dbReady }) =>
      Effect.gen(function* () {
        const { dbLog } = yield* LeaderThreadCtx

        {
          const initialSyncHead =
            dbLog.select<{ head: number }>(sql`select head from ${SYNC_STATUS_TABLE}`)[0]?.head ?? ROOT_ID.global

          syncHeadRef.current = initialSyncHead

          // rehydrate pushQueue from dbLog
          {
            const query = mutationLogMetaTable.query.where('idGlobal', '>', initialSyncHead).asSql()
            const pendingMutationEventsRaw = dbLog.select(query.query, prepareBindValues(query.bindValues, query.query))
            const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
              pendingMutationEventsRaw,
            )

            yield* push(
              pendingMutationEvents.map((_) => ({
                mutationEventEncoded: {
                  mutation: _.mutation,
                  args: _.argsJson,
                  id: { global: _.idGlobal, local: _.idLocal },
                  parentId: { global: _.parentIdGlobal, local: _.parentIdLocal },
                },
              })),
            )
          }
        }

        yield* executeMutationsLoop(executeQueue)

        yield* backgroundPushing({ dbReady, syncQueue })

        return yield* backgroundPulling({ dbReady, syncHeadRef, executeQueue })
      }).pipe(Effect.withSpanScoped('@livestore/common:leader-thread:syncing'))

    return { push, initSyncing } satisfies PushQueueLeader
  })

const getCursorInfo = (syncHead: number) =>
  Effect.gen(function* () {
    const { dbLog } = yield* LeaderThreadCtx

    if (syncHead === ROOT_ID.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.headOrElse())

    const syncMetadataOption = yield* Effect.sync(() =>
      dbLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${syncHead} ORDER BY idLocal ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.orDie)

    return Option.some({
      cursor: { global: syncHead, local: 0 },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  })

const executeMutationsLoop = (executeQueue: Queue.Queue<PushQueueItemLeader>) =>
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { db, dbLog } = leaderThreadCtx

    const applyMutation = yield* makeApplyMutation

    yield* Effect.gen(function* () {
      const batchItems = yield* Queue.takeBetween(executeQueue, 1, 50)

      try {
        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        // Now we're sending the mutation event to all "pulling" client sessions
        for (const queue of leaderThreadCtx.connectedClientSessionPullQueues) {
          // TODO do batching if possible
          yield* Queue.offer(queue, {
            mutationEvents: [...batchItems].map((_) => _.mutationEventEncoded),
            remaining: 0,
          })
        }

        for (const { mutationEventEncoded, deferred } of batchItems) {
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

          if (deferred) {
            yield* Deferred.succeed(deferred, void 0)
          }
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

const backgroundPulling = ({
  dbReady,
  syncHeadRef,
  executeQueue,
}: {
  dbReady: Deferred.Deferred<void>
  syncHeadRef: { current: number }
  executeQueue: Queue.Queue<PushQueueItemLeader>
}) =>
  Effect.gen(function* () {
    const { syncBackend, bootStatusQueue, dbLog, initialSyncOptions } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    const waitForInitialSync =
      initialSyncOptions._tag === 'Blocking'
        ? yield* Deferred.make<void>().pipe(
            Effect.tap((def) =>
              Deferred.succeed(def, void 0).pipe(Effect.delay(initialSyncOptions.timeout), Effect.forkScoped),
            ),
          )
        : undefined

    let initialSyncDone = false
    const cursorInfo = yield* getCursorInfo(syncHeadRef.current)

    const initialSyncContext = { processedMutations: 0, total: -1 }

    const onNewPullChunk = (chunk: MutationEvent.AnyEncoded[]) =>
      Effect.gen(function* () {
        if (chunk.length === 0) return

        // TODO either use `sessionId` to verify or introduce a new nanoid-field
        const hasLocalPendingEvents = false

        if (hasLocalPendingEvents) {
          const matchesPendingEvents = true

          if (matchesPendingEvents) {
            // apply chunk to read model
            const mode = 'leader' // TODO

            if (mode === 'leader') {
              // forward chunk to client sessions
              // remove from items
            } else {
              // if confirmed by sync backend, remove from items
            }
          } else {
            // rebase
            // yield* rebasePushQueue(chunk)
          }
        } else {
          yield* executeQueue.offerAll(chunk.map((_) => ({ mutationEventEncoded: _, deferred: undefined })))

          const head = chunk.at(-1)!.id.global

          yield* execSql(dbLog, sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head}`, {}).pipe(Effect.orDie)

          syncHeadRef.current = head
        }
      })

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ items, remaining }) =>
        Effect.gen(function* () {
          // NOTE this is a temporary workaround until rebase-syncing is implemented
          // const items = items_.filter(
          //   (_) => _.mutationEventEncoded.id.global > currentMutationEventIdRef.current.global,
          // )

          if (initialSyncContext.total === -1) {
            initialSyncContext.total = remaining + items.length
          }

          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          // TODO pass in metadata
          yield* onNewPullChunk(items.map((_) => _.mutationEventEncoded))

          if (waitForInitialSync !== undefined) {
            initialSyncContext.processedMutations += items.length
            yield* Queue.offer(bootStatusQueue, {
              stage: 'syncing',
              progress: { done: initialSyncContext.processedMutations, total: initialSyncContext.total },
            })
          }

          if (initialSyncDone === false && remaining === 0 && waitForInitialSync !== undefined) {
            yield* Deferred.succeed(waitForInitialSync, void 0)
            initialSyncDone = true
          }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/common:leader-thread:syncing:pulling'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    return waitForInitialSync
  })

const backgroundPushing = ({
  dbReady,
  syncQueue,
}: {
  dbReady: Deferred.Deferred<void>
  syncQueue: Queue.Queue<MutationEvent.AnyEncoded>
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbLog } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* dbReady

    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

    // TODO also wait for pulling to be done

    // TODO make batch size configurable
    // TODO peek instead of take
    const queueItems = yield* syncQueue.takeBetween(1, 50)

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
