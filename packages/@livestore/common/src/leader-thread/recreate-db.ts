import { casesHandled } from '@livestore/utils'
import type { HttpClient } from '@livestore/utils/effect'
import { Effect, Queue } from '@livestore/utils/effect'

import type { InvalidPullError, IsOfflineError, MigrationHooks, SqliteError } from '../index.js'
import { initializeSingletonTables, migrateDb, rehydrateFromMutationLog, UnexpectedError } from '../index.js'
import { configureConnection } from './connection.js'
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
  yield* Effect.sync(() => db.import(tmpSyncDb)).pipe(
    Effect.withSpan('@livestore/common:leader-thread:recreateDb:import'),
  )

  // TODO maybe bring back re-using this initial snapshot to avoid calling `.export()` again
  // We've disabled this for now as it made the code too complex, as we often run syncing right after
  // so the snapshot is no longer up to date
  // const snapshotFromTmpDb = tmpSyncDb.export()

  tmpSyncDb.close()
}).pipe(
  Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
  Effect.withSpan('@livestore/common:leader-thread:recreateDb'),
  Effect.withPerformanceMeasure('@livestore/common:leader-thread:recreateDb'),
)
