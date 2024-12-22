import { casesHandled, memoizeByStringifyArgs } from '@livestore/utils'
import type { HttpClient } from '@livestore/utils/effect'
import { Effect, Option, Queue, Schema, Stream } from '@livestore/utils/effect'

import type { InvalidPullError, IsOfflineError, MigrationHooks, SqliteError, SynchronousDatabase } from '../index.js'
import {
  initializeSingletonTables,
  migrateDb,
  MUTATION_LOG_META_TABLE,
  rehydrateFromMutationLog,
  sql,
  UnexpectedError,
} from '../index.js'
import { makeApplyMutation } from './apply-mutation.js'
import { configureConnection } from './connection.js'
import type { InitialSyncInfo } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const recreateDb: Effect.Effect<
  void,
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | HttpClient.HttpClient
> = Effect.gen(function* () {
  const { db, dbLog, makeSyncDb, schema, bootStatusQueue } = yield* LeaderThreadCtx

  const migrationOptions = schema.migrationOptions

  yield* Effect.addFinalizer(
    Effect.fn('recreateDb:finalizer')(function* (ex) {
      if (ex._tag === 'Failure') db.destroy()
    }),
  )

  // NOTE to speed up the operations below, we're creating a temporary in-memory database
  // and later we'll overwrite the persisted database with the new data
  const tmpSyncDb = yield* makeSyncDb({ _tag: 'in-memory' })
  yield* configureConnection(tmpSyncDb, { fkEnabled: true })

  const initDb = (hooks: Partial<MigrationHooks> | undefined) =>
    Effect.gen(function* () {
      yield* Effect.tryAll(() => hooks?.init?.(tmpSyncDb)).pipe(UnexpectedError.mapToUnexpectedError)

      yield* migrateDb({
        db: tmpSyncDb,
        schema,
        onProgress: ({ done, total }) =>
          Queue.offer(bootStatusQueue, { stage: 'migrating', progress: { done, total } }),
      })

      initializeSingletonTables(schema, tmpSyncDb)

      yield* Effect.tryAll(() => hooks?.pre?.(tmpSyncDb)).pipe(UnexpectedError.mapToUnexpectedError)

      return tmpSyncDb
    })

  switch (migrationOptions.strategy) {
    case 'from-mutation-log': {
      const hooks = migrationOptions.hooks
      const tmpSyncDb = yield* initDb(hooks)

      yield* rehydrateFromMutationLog({
        db: tmpSyncDb,
        logDb: dbLog,
        schema,
        migrationOptions,
        onProgress: ({ done, total }) =>
          Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
      })

      yield* Effect.tryAll(() => hooks?.post?.(tmpSyncDb)).pipe(UnexpectedError.mapToUnexpectedError)

      break
    }
    case 'hard-reset': {
      const hooks = migrationOptions.hooks
      const tmpInMemoryDb = yield* initDb(hooks)

      // The database is migrated but empty now, so nothing else to do

      yield* Effect.tryAll(() => hooks?.post?.(tmpInMemoryDb)).pipe(UnexpectedError.mapToUnexpectedError)

      break
    }
    case 'manual': {
      const oldDbData = db.export()

      const newDbData = yield* Effect.tryAll(() => migrationOptions.migrate(oldDbData)).pipe(
        UnexpectedError.mapToUnexpectedError,
      )

      tmpSyncDb.import(newDbData)

      // TODO validate schema

      break
    }
    default: {
      casesHandled(migrationOptions)
    }
  }

  // Import the temporary in-memory database into the persistent database
  yield* Effect.sync(() => db.import(tmpSyncDb)).pipe(Effect.withSpan('@livestore/web:worker:recreateDb:import'))

  // TODO maybe bring back re-using this initial snapshot to avoid calling `.export()` again
  // We've disabled this for now as it made the code too complex, as we often run syncing right after
  // so the snapshot is no longer up to date
  // const snapshotFromTmpDb = tmpSyncDb.export()

  tmpSyncDb.close()
}).pipe(
  Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
  Effect.withSpan('@livestore/web:worker:recreateDb'),
  Effect.withPerformanceMeasure('@livestore/web:worker:recreateDb'),
)

// TODO replace with proper rebasing impl
export const pullAndApplyRemoteMutations = ({
  db,
  shouldBroadcast,
  onProgress,
}: {
  db: SynchronousDatabase
  shouldBroadcast: boolean
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const { syncBackend, currentMutationEventIdRef } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return Option.none() as InitialSyncInfo

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = yield* makeApplyMutation(createdAtMemo, db)

    let processedMutations = 0

    const cursorInfo = yield* getCursorInfo

    let total = -1

    const lastSyncEvent = yield* syncBackend.pull(cursorInfo, { listenForNew: false }).pipe(
      Stream.tap(({ mutationEventEncoded, metadata, remaining }) =>
        Effect.gen(function* () {
          if (total === -1) {
            // To account for the current mutation event we're adding 1 to the total
            total = remaining + 1
          }

          // NOTE this is a temporary workaround until rebase-syncing is implemented
          if (mutationEventEncoded.id.global <= currentMutationEventIdRef.current.global) {
            return
          }

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          yield* applyMutation(mutationEventEncoded, {
            syncStatus: 'synced',
            shouldBroadcast,
            persisted: true,
            inTransaction: false,
            syncMetadataJson: metadata,
          }).pipe(
            Effect.andThen(() => {
              processedMutations += 1
              return onProgress({ done: processedMutations, total })
            }),
          )
        }),
      ),
      Stream.runLast,
    )

    // In case there weren't any new synced events, we return the current cursor info
    if (lastSyncEvent._tag === 'None') return cursorInfo

    return lastSyncEvent.pipe(
      Option.map((lastSyncEvent) => ({
        cursor: lastSyncEvent.mutationEventEncoded.id,
        metadata: lastSyncEvent.metadata,
      })),
    ) as InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/web:worker:pullAndApplyRemoteMutations'))

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
