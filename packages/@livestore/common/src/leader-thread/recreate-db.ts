import { casesHandled } from '@livestore/utils'
import type { HttpClient } from '@livestore/utils/effect'
import { Effect, Queue } from '@livestore/utils/effect'

import type { InvalidPullError, IsOfflineError, MigrationHooks, MigrationsReport, SqliteError } from '../index.js'
import { migrateDb, rehydrateFromEventlog, UnexpectedError } from '../index.js'
import { configureConnection } from './connection.js'
import { LeaderThreadCtx } from './types.js'

export const recreateDb: Effect.Effect<
  { migrationsReport: MigrationsReport },
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | HttpClient.HttpClient
> = Effect.gen(function* () {
  const { dbReadModel, dbEventlog, schema, bootStatusQueue, applyEvent } = yield* LeaderThreadCtx

  const migrationOptions = schema.migrationOptions
  let migrationsReport: MigrationsReport

  yield* Effect.addFinalizer(
    Effect.fn('recreateDb:finalizer')(function* (ex) {
      if (ex._tag === 'Failure') dbReadModel.destroy()
    }),
  )

  // NOTE to speed up the operations below, we're creating a temporary in-memory database
  // and later we'll overwrite the persisted database with the new data
  // TODO bring back this optimization
  // const tmpDb = yield* makeSqliteDb({ _tag: 'in-memory' })
  const tmpDb = dbReadModel
  yield* configureConnection(tmpDb, { foreignKeys: true })

  const initDb = (hooks: Partial<MigrationHooks> | undefined) =>
    Effect.gen(function* () {
      yield* Effect.tryAll(() => hooks?.init?.(tmpDb)).pipe(UnexpectedError.mapToUnexpectedError)

      const migrationsReport = yield* migrateDb({
        db: tmpDb,
        schema,
        onProgress: ({ done, total }) =>
          Queue.offer(bootStatusQueue, { stage: 'migrating', progress: { done, total } }),
      })

      yield* Effect.tryAll(() => hooks?.pre?.(tmpDb)).pipe(UnexpectedError.mapToUnexpectedError)

      return { migrationsReport, tmpDb }
    })

  switch (migrationOptions.strategy) {
    case 'from-mutation-log': {
      const hooks = migrationOptions.hooks
      const initResult = yield* initDb(hooks)

      migrationsReport = initResult.migrationsReport

      yield* rehydrateFromEventlog({
        // db: initResult.tmpDb,
        dbEventlog,
        schema,
        migrationOptions,
        applyEvent,
        onProgress: ({ done, total }) =>
          Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
      })

      yield* Effect.tryAll(() => hooks?.post?.(initResult.tmpDb)).pipe(UnexpectedError.mapToUnexpectedError)

      break
    }
    case 'hard-reset': {
      const hooks = migrationOptions.hooks
      const initResult = yield* initDb(hooks)

      migrationsReport = initResult.migrationsReport

      // The database is migrated but empty now, so nothing else to do

      yield* Effect.tryAll(() => hooks?.post?.(initResult.tmpDb)).pipe(UnexpectedError.mapToUnexpectedError)

      break
    }
    case 'manual': {
      const oldDbData = dbReadModel.export()

      migrationsReport = { migrations: [] }

      const newDbData = yield* Effect.tryAll(() => migrationOptions.migrate(oldDbData)).pipe(
        UnexpectedError.mapToUnexpectedError,
      )

      tmpDb.import(newDbData)

      // TODO validate schema

      break
    }
    default: {
      casesHandled(migrationOptions)
    }
  }

  // TODO bring back
  // Import the temporary in-memory database into the persistent database
  // yield* Effect.sync(() => db.import(tmpDb)).pipe(
  //   Effect.withSpan('@livestore/common:leader-thread:recreateDb:import'),
  // )

  // TODO maybe bring back re-using this initial snapshot to avoid calling `.export()` again
  // We've disabled this for now as it made the code too complex, as we often run syncing right after
  // so the snapshot is no longer up to date
  // const snapshotFromTmpDb = tmpDb.export()

  // TODO bring back
  // tmpDb.close()

  return { migrationsReport }
}).pipe(
  Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
  Effect.withSpan('@livestore/common:leader-thread:recreateDb'),
  Effect.withPerformanceMeasure('@livestore/common:leader-thread:recreateDb'),
)
