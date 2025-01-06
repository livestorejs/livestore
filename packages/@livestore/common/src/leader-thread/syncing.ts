import { Chunk, Deferred, Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { ROOT_ID } from '../adapter-types.js'
import {
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SYNC_STATUS_TABLE,
  syncStatusTable,
} from '../schema/system-tables.js'
import { updateRows } from '../sql-queries/sql-queries.js'
import { prepareBindValues, sql } from '../util.js'
import { execSql } from './connection.js'
import type { InitialSyncInfo } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const initSyncing = ({
  dbReady,
  waitForInitialSyncRef,
}: {
  dbReady: Deferred.Deferred<void>
  waitForInitialSyncRef: { current: Deferred.Deferred<void> | undefined }
}) =>
  Effect.gen(function* () {
    const { syncBackend, currentMutationEventIdRef, dbLog, syncPushQueue, bootStatusQueue } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* syncPushQueue.executeMutationsLoop

    const cursorInfo = yield* getCursorInfo

    console.log('cursorInfo', cursorInfo)

    // Initial sync context
    let processedMutations = 0
    let total = -1

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ items, remaining }) =>
        Effect.gen(function* () {
          // NOTE this is a temporary workaround until rebase-syncing is implemented
          // const items = items_.filter(
          //   (_) => _.mutationEventEncoded.id.global > currentMutationEventIdRef.current.global,
          // )

          if (total === -1) {
            total = remaining + items.length
          }

          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          // TODO pass in metadata
          yield* syncPushQueue.onNewPullChunk(items.map((_) => _.mutationEventEncoded))

          if (waitForInitialSyncRef.current !== undefined) {
            processedMutations += items.length
            yield* Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done: processedMutations, total } })
          }

          if (remaining === 0 && waitForInitialSyncRef.current !== undefined) {
            yield* Deferred.succeed(waitForInitialSyncRef.current, void 0)
            waitForInitialSyncRef.current = undefined
          }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/common:leader-thread:syncBackend:pulling'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* dbReady

    // Continously pushes mutations to the sync backend from the push queue
    yield* Effect.gen(function* () {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO also wait for pulling to be done

      // TODO make batch size configurable
      // TODO peek instead of take
      const queueItems = yield* syncPushQueue.syncQueue.takeBetween(1, 50)

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
      Effect.withSpan('@livestore/common:leader-thread:syncBackend:pushing'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* Effect.never
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:syncBackend:initSyncing'))

const getCursorInfo = Effect.gen(function* () {
  const { dbLog, syncPushQueue } = yield* LeaderThreadCtx

  const syncHead = syncPushQueue.syncHeadRef.current
  console.log('syncHead', syncHead)

  if (syncHead === ROOT_ID.global) return Option.none()

  const MutationlogQuerySchema = Schema.Struct({
    syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
  }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.headOrElse())

  const syncMetadataOption = yield* Effect.try(() =>
    dbLog.select<{ syncMetadataJson: string }>(
      sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${syncHead} ORDER BY idLocal ASC LIMIT 1`,
    ),
  ).pipe(
    Effect.andThen(Schema.decode(MutationlogQuerySchema)),
    // NOTE this initially fails when the table doesn't exist yet
    // Effect.catchAll(() => Effect.succeed(undefined)),
  )

  // if (syncPullInfo === undefined) return Option.none()

  return Option.some({
    cursor: { global: syncHead, local: 0 },
    metadata: syncMetadataOption,
  }) satisfies InitialSyncInfo
})
