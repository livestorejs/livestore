import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import type { SqliteError, UnexpectedError } from '../adapter-types.js'
import { MUTATION_LOG_META_TABLE, mutationLogMetaTable } from '../schema/system-tables.js'
import { migrateTable } from '../schema-management/migrations.js'
import { updateRows } from '../sql-queries/sql-queries.js'
import type { InvalidPullError, IsOfflineError } from '../sync/sync.js'
import { prepareBindValues, sql } from '../util.js'
import type { ApplyMutation } from './apply-mutation.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import { pullAndApplyRemoteMutations, recreateDb } from './recreate-db.js'
import type { InitialSyncInfo } from './types.js'
import { LeaderThreadCtx } from './types.js'

/**
 * Blocks until the leader thread has finished its initial setup.
 * It also starts various background processes (e.g. syncing)
 */
export const bootLeaderThread: Effect.Effect<
  void,
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> = Effect.gen(function* () {
  const leaderThreadCtx = yield* LeaderThreadCtx

  // @ts-expect-error For debugging purposes
  globalThis.__leaderThreadCtx = leaderThreadCtx

  const { db, dbLog, bootStatusQueue, currentMutationEventIdRef, initialSyncOptions } = leaderThreadCtx

  yield* migrateTable({
    db: dbLog,
    behaviour: 'create-if-not-exists',
    tableAst: mutationLogMetaTable.sqliteDef.ast,
    skipMetaTable: true,
  })

  // TODO do more validation here
  const needsRecreate = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

  const initializeCurrentMutationEventId = Effect.gen(function* () {
    const initialMutationEventId = dbLog.select<{ idGlobal: number; idLocal: number }>(
      sql`select idGlobal, idLocal from ${MUTATION_LOG_META_TABLE} order by idGlobal DESC, idLocal DESC limit 1`,
    )[0]

    if (initialMutationEventId !== undefined) {
      currentMutationEventIdRef.current = {
        global: initialMutationEventId.idGlobal,
        local: initialMutationEventId.idLocal,
      }
    }
  })

  if (needsRecreate) {
    yield* recreateDb
  }

  yield* initializeCurrentMutationEventId

  // TODO unify with sync-pulling below (so it's a single pull call)
  // TODO also already kick off pulling concurrently as network IO can take a while
  let syncInfo: InitialSyncInfo
  if (initialSyncOptions._tag === 'Blocking') {
    syncInfo = yield* pullAndApplyRemoteMutations({
      db,
      shouldBroadcast: true,
      onProgress: ({ done, total }) => Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done, total } }),
    }).pipe(
      Effect.timeout(initialSyncOptions.timeout),
      Effect.catchTag('TimeoutException', () => Effect.succeed(Option.none())),
      Effect.withSpan('@livestore/web:worker:initialSync(blocking)'),
    )
  } else {
    syncInfo = Option.none()
  }

  yield* Queue.offer(bootStatusQueue, { stage: 'done' })

  const applyMutation = yield* makeApplyMutation(() => new Date().toISOString(), db)

  // TODO start earlier to give sync backend a chance to pull concurrently
  yield* initSyncing({ syncInfo, applyMutation }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
})

const initSyncing = ({ syncInfo, applyMutation }: { syncInfo: InitialSyncInfo; applyMutation: ApplyMutation }) =>
  Effect.gen(function* () {
    const { syncBackend, currentMutationEventIdRef, dbLog, syncPushQueue } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    // TODO try to do this in a batched-way if possible
    yield* syncBackend.pull(syncInfo, { listenForNew: true }).pipe(
      // TODO only take from queue while connected
      // Filter out "own" mutations
      // Stream.filter((_) => _.mutationEventEncoded.id.startsWith(originId) === false),
      Stream.tap(({ mutationEventEncoded, persisted, metadata }) =>
        Effect.gen(function* () {
          // TODO bring back and properly implement by running some of the code above concurrently
          // yield* initialSetupDeferred

          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // NOTE this is a temporary workaround until rebase-syncing is implemented
          if (mutationEventEncoded.id.global <= currentMutationEventIdRef.current.global) {
            return
          }

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          yield* applyMutation(mutationEventEncoded, {
            syncStatus: 'synced',
            shouldBroadcast: true,
            persisted,
            inTransaction: false,
            syncMetadataJson: metadata,
          })
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/web:worker:syncBackend:pulling'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // rehydrate pushQueue from dbLog
    {
      const query = mutationLogMetaTable.query.where({ syncStatus: 'pending' }).asSql()
      const pendingMutationEventsRaw = dbLog.select(query.query, prepareBindValues(query.bindValues, query.query))
      const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
        pendingMutationEventsRaw,
      )

      yield* syncPushQueue.queue.offerAll(
        pendingMutationEvents.map((_) => ({
          mutation: _.mutation,
          args: _.argsJson,
          id: { global: _.idGlobal, local: _.idLocal },
          parentId: { global: _.parentIdGlobal, local: _.parentIdLocal },
        })),
      )
    }

    // Continously pushes mutations to the sync backend from the push queue
    yield* Effect.gen(function* () {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO also wait for pulling to be done

      // TODO make batch size configurable
      // TODO peek instead of take
      const queueItems = yield* syncPushQueue.queue.takeBetween(1, 50)

      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO batch this
      for (const mutationEventEncoded of queueItems) {
        // TODO handle push errors (should only happen during concurrent pull+push)
        const { metadata } = yield* syncBackend.push([mutationEventEncoded], true)

        yield* execSql(
          dbLog,
          ...updateRows({
            tableName: MUTATION_LOG_META_TABLE,
            columns: mutationLogMetaTable.sqliteDef.columns,
            where: { idGlobal: mutationEventEncoded.id.global, idLocal: mutationEventEncoded.id.local },
            updateValues: { syncStatus: 'synced', syncMetadataJson: metadata[0]! },
          }),
        )
      }
    }).pipe(
      Effect.forever,
      Effect.interruptible,
      Effect.withSpan('@livestore/web:worker:syncBackend:pushing'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* Effect.never
  })
