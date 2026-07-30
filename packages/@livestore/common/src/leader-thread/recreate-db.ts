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
import type * as MaterializationJournal from '../MaterializationJournal.ts'
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
  UnknownError | MaterializeError | MaterializationJournal.MaterializationJournalError | SqliteError
> =>
  Effect.gen(function* () {
    const hooks = schema.state.sqlite.migrations.hooks

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

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.init?.(tmpDb)).pipe(UnknownError.mapToUnknownError)

    const migrationsReport = yield* migrateDb({
      db: tmpDb,
      schema,
      onProgress: ({ done, total }) => Queue.offer(bootStatusQueue, { stage: 'migrating', progress: { done, total } }),
    })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.pre?.(tmpDb)).pipe(UnknownError.mapToUnknownError)

    yield* rematerializeFromEventlog({
      // db: tmpDb,
      dbEventlog,
      schema,
      materializeEvent,
      onProgress: ({ done, total }) =>
        Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
    })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- user hook errors are immediately normalized to LiveStore UnknownError
    yield* Effect.trySyncOrPromiseOrEffect(() => hooks?.post?.(tmpDb)).pipe(UnknownError.mapToUnknownError)

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
