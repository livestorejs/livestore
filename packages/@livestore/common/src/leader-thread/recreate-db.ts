import { casesHandled } from '@livestore/utils'
import { Effect, Queue } from '@livestore/utils/effect'

import type { MigrationsReport } from '../defs.ts'
import {
  type BootStatus,
  type MaterializerHashMismatchError,
  type MigrationHooks,
  migrateDb,
  rematerializeFromEventlog,
  type SqliteDb,
  type SqliteError,
  UnexpectedError,
} from '../index.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { configureConnection } from './connection.ts'
import type { MaterializeEvent } from './types.ts'

export const recreateDb = ({
  dbState,
  dbEventlog,
  schema,
  bootStatusQueue,
  materializeEvent,
}: {
  dbState: SqliteDb
  dbEventlog: SqliteDb
  schema: LiveStoreSchema
  bootStatusQueue: Queue.Queue<BootStatus>
  materializeEvent: MaterializeEvent
}): Effect.Effect<
  { migrationsReport: MigrationsReport },
  UnexpectedError | SqliteError | MaterializerHashMismatchError
> =>
  Effect.gen(function* () {
    const migrationOptions = schema.state.sqlite.migrations
    let migrationsReport: MigrationsReport

    yield* Effect.addFinalizer(
      Effect.fn('recreateDb:finalizer')(function* (ex) {
        if (ex._tag === 'Failure') dbState.destroy()
      }),
    )

    // NOTE to speed up the operations below, we're creating a temporary in-memory database
    // and later we'll overwrite the persisted database with the new data
    // TODO bring back this optimization
    // const tmpDb = yield* makeSqliteDb({ _tag: 'in-memory' })
    const tmpDb = dbState
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
      case 'auto': {
        const hooks = migrationOptions.hooks
        const initResult = yield* initDb(hooks)

        migrationsReport = initResult.migrationsReport

        yield* rematerializeFromEventlog({
          // db: initResult.tmpDb,
          dbEventlog,
          schema,
          materializeEvent,
          onProgress: ({ done, total }) =>
            Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
        })

        yield* Effect.tryAll(() => hooks?.post?.(initResult.tmpDb)).pipe(UnexpectedError.mapToUnexpectedError)

        break
      }
      case 'manual': {
        const oldDbData = dbState.export()

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
