import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import type { SqliteError, UnexpectedError } from '../adapter-types.js'
import { MUTATION_LOG_META_TABLE, mutationLogMetaTable } from '../schema/system-tables.js'
import { migrateTable } from '../schema-management/migrations.js'
import { updateRows } from '../sql-queries/sql-queries.js'
import type { InvalidPullError, IsOfflineError } from '../sync/sync.js'
import { prepareBindValues, sql } from '../util.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import { recreateDb } from './recreate-db.js'
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

  const dbReady = yield* Deferred.make<void>()

  const waitForInitialSync =
    initialSyncOptions._tag === 'Blocking'
      ? yield* Deferred.make<void>().pipe(
          Effect.tap((def) =>
            Deferred.succeed(def, void 0).pipe(Effect.delay(initialSyncOptions.timeout), Effect.forkScoped),
          ),
        )
      : undefined

  // We're already starting pulling from the sync backend concurrently but wait until the db is ready before
  // processing any incoming mutations
  yield* initSyncing({ dbReady, waitForInitialSyncRef: { current: waitForInitialSync } }).pipe(
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )

  // TODO do more validation here
  const needsRecreate = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

  if (needsRecreate) {
    yield* recreateDb
  }

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

  yield* initializeCurrentMutationEventId

  yield* Deferred.succeed(dbReady, void 0)

  if (waitForInitialSync !== undefined) {
    yield* Deferred.succeed(waitForInitialSync, void 0)

    yield* waitForInitialSync
  }

  yield* Queue.offer(bootStatusQueue, { stage: 'done' })
})

const initSyncing = ({
  dbReady,
  waitForInitialSyncRef,
}: {
  dbReady: Deferred.Deferred<void>
  waitForInitialSyncRef: { current: Deferred.Deferred<void> | undefined }
}) =>
  Effect.gen(function* () {
    const { syncBackend, currentMutationEventIdRef, db, dbLog, syncPushQueue, bootStatusQueue } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    const applyMutation = yield* makeApplyMutation(() => new Date().toISOString(), db)

    const cursorInfo = yield* getCursorInfo

    // Initial sync context
    let processedMutations = 0
    let total = -1

    // TODO try to do this in a batched-way if possible
    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ items, remaining }) =>
        Effect.gen(function* () {
          // TODO bring back and properly implement by running some of the code above concurrently
          // yield* initialSetupDeferred

          if (total === -1) {
            total = remaining + items.length
          }

          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          for (const { mutationEventEncoded, persisted, metadata } of items) {
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

            if (waitForInitialSyncRef.current !== undefined) {
              processedMutations += 1
              yield* Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done: processedMutations, total } })
            }
          }

          if (remaining === 0 && waitForInitialSyncRef.current !== undefined) {
            yield* Deferred.succeed(waitForInitialSyncRef.current, void 0)
            waitForInitialSyncRef.current = undefined
          }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/web:worker:syncBackend:pulling'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* dbReady

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
  }).pipe(Effect.withSpan('@livestore/web:worker:syncBackend:initSyncing'))

const getCursorInfo = Effect.gen(function* () {
  const { dbLog } = yield* LeaderThreadCtx

  const MutationlogQuerySchema = Schema.Struct({
    idGlobal: Schema.Number,
    idLocal: Schema.Number,
    syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
  }).pipe(Schema.Array, Schema.headOrElse())

  const syncPullInfo = yield* Effect.try(() =>
    dbLog.select<{ idGlobal: number; idLocal: number; syncMetadataJson: string }>(
      sql`SELECT idGlobal, idLocal, syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE syncStatus = 'synced' ORDER BY idGlobal DESC LIMIT 1`,
    ),
  ).pipe(
    Effect.andThen(Schema.decode(MutationlogQuerySchema)),
    // NOTE this initially fails when the table doesn't exist yet
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

  if (syncPullInfo === undefined) return Option.none()

  return Option.some({
    cursor: { global: syncPullInfo.idGlobal, local: syncPullInfo.idLocal },
    metadata: syncPullInfo.syncMetadataJson,
  }) satisfies InitialSyncInfo
})
