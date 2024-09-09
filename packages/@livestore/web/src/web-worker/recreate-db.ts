import type { MigrationHooks } from '@livestore/common'
import { initializeSingletonTables, migrateDb, rehydrateFromMutationLog, UnexpectedError } from '@livestore/common'
import { casesHandled, memoizeByStringifyArgs } from '@livestore/utils'
import { Effect, Queue, Stream } from '@livestore/utils/effect'

import { WaSqlite } from '../sqlite/index.js'
import { makeSynchronousDatabase } from '../sqlite/make-sync-db.js'
import type { InnerWorkerCtx } from './common.js'
import { configureConnection, makeApplyMutation } from './common.js'

export const recreateDb = (workerCtx: typeof InnerWorkerCtx.Service) =>
  Effect.gen(function* () {
    const { db, dbLog, sqlite3, schema, bootStatusQueue } = workerCtx

    const migrationOptions = schema.migrationOptions

    yield* Effect.addFinalizer((ex) => {
      if (ex._tag === 'Success') return Effect.void
      return db.destroy.pipe(Effect.tapCauseLogPretty, Effect.orDie)
    })

    // NOTE to speed up the operations below, we're creating a temporary in-memory database
    // and later we'll overwrite the persisted database with the new data
    const tmpDb = WaSqlite.makeInMemoryDb(sqlite3)
    const tmpSyncDb = makeSynchronousDatabase(sqlite3, tmpDb)
    yield* configureConnection({ syncDb: tmpSyncDb }, { fkEnabled: true })

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

    const syncDbLog = dbLog.dbRef.current.syncDb

    switch (migrationOptions.strategy) {
      case 'from-mutation-log': {
        const hooks = migrationOptions.hooks
        const tmpSyncDb = yield* initDb(hooks)

        yield* rehydrateFromMutationLog({
          db: tmpSyncDb,
          logDb: syncDbLog,
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
        const oldDbData = yield* db.export

        const newDbData = yield* Effect.tryAll(() => migrationOptions.migrate(oldDbData)).pipe(
          UnexpectedError.mapToUnexpectedError,
        )

        WaSqlite.importBytesToDb(sqlite3, tmpDb, newDbData)

        // TODO validate schema

        break
      }
      default: {
        casesHandled(migrationOptions)
      }
    }

    yield* fetchAndApplyRemoteMutations(workerCtx, tmpDb, false, ({ done, total }) =>
      Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done, total } }),
    )

    yield* db.import({ pointer: tmpDb })

    const snapshotFromTmpDb = WaSqlite.exportDb(sqlite3, tmpDb)

    sqlite3.close(tmpDb)

    return snapshotFromTmpDb
  }).pipe(
    Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
    Effect.withSpan('@livestore/web:worker:recreateDb'),
    Effect.withPerformanceMeasure('@livestore/web:worker:recreateDb'),
  )

// TODO replace with proper rebasing impl
export const fetchAndApplyRemoteMutations = (
  workerCtx: typeof InnerWorkerCtx.Service,
  db: number,
  shouldBroadcast: boolean,
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    if (workerCtx.sync === undefined) return
    const { sync } = workerCtx

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = makeApplyMutation(workerCtx, createdAtMemo, db)

    let processedMutations = 0

    // TODO stash and rebase local mutations on top of remote mutations
    // probably using the SQLite session extension
    yield* sync.inititialMessages.pipe(
      Stream.tap(({ mutationEventEncoded, metadata }) =>
        applyMutation(mutationEventEncoded, {
          syncStatus: 'synced',
          shouldBroadcast,
          persisted: true,
          inTransaction: false,
          syncMetadataJson: metadata,
        }).pipe(
          Effect.andThen(() => {
            processedMutations += 1
            // TODO fix total
            return onProgress({ done: processedMutations, total: processedMutations })
          }),
        ),
      ),
      Stream.runDrain,
    )
  }).pipe(Effect.withSpan('@livestore/web:worker:fetchAndApplyRemoteMutations'))
