import { Effect, Queue } from '@livestore/utils/effect'

import type { MigrationsReport } from '../defs.ts'
import {
  type BootStatus,
  type MaterializeError,
  migrateDb,
  rematerializeFromEventlog,
  type SqliteDb,
  type SqliteError,
  UnknownError,
} from '../index.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { SystemTables } from '../schema/mod.ts'
import { configureConnection, execSql } from './connection.ts'
import type { MaterializeEvent } from './types.ts'

export const hasCompletedState = (db: SqliteDb): boolean => {
  const tableNames = new Set(db.select<{ name: string }>('SELECT name FROM sqlite_master').map((_) => _.name))
  return (
    SystemTables.stateSystemTables.every((table) => tableNames.has(table.sqliteDef.name)) &&
    db.select(`SELECT id FROM ${SystemTables.REBUILD_META_TABLE} WHERE id = 1`).length === 1
  )
}

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
}): Effect.Effect<{ migrationsReport: MigrationsReport }, UnknownError | MaterializeError | SqliteError> =>
  Effect.gen(function* () {
    const hooks = schema.state.sqlite.migrations.hooks

    yield* Effect.addFinalizer(
      Effect.fn('recreateDb:finalizer')(function* (ex) {
        if (ex._tag === 'Failure') dbState.destroy()
      }),
    )

    yield* configureConnection(dbState, { foreignKeys: true })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.init?.(dbState)).pipe(UnknownError.mapToUnknownError)

    const migrationsReport = yield* migrateDb({
      db: dbState,
      schema,
      onProgress: ({ done, total }) => Queue.offer(bootStatusQueue, { stage: 'migrating', progress: { done, total } }),
    })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.pre?.(dbState)).pipe(UnknownError.mapToUnknownError)

    yield* rematerializeFromEventlog({
      dbEventlog,
      schema,
      materializeEvent,
      onProgress: ({ done, total }) =>
        Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
    })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.post?.(dbState)).pipe(UnknownError.mapToUnknownError)

    // Keep this out of finalizers, which also run on failure and interruption.
    yield* execSql(dbState, `INSERT INTO ${SystemTables.REBUILD_META_TABLE} (id) VALUES (1)`, {})

    return { migrationsReport }
  }).pipe(
    Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
    Effect.withSpan('@livestore/common:leader-thread:recreateDb'),
    Effect.withPerformanceMeasure('@livestore/common:leader-thread:recreateDb'),
  )
