import type { MigrationHooks } from '@livestore/common'
import {
  initializeSingletonTables,
  migrateDb,
  migrateTable,
  rehydrateFromMutationLog,
  UnexpectedError,
} from '@livestore/common'
import { mutationLogMetaTable } from '@livestore/common/schema'
import { casesHandled, memoizeByStringifyArgs } from '@livestore/utils'
import type { Context } from '@livestore/utils/effect'
import { Effect, Queue, Stream } from '@livestore/utils/effect'

import { makeInMemoryDb } from '../make-in-memory-db.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import { importBytesToDb } from '../sqlite-utils.js'
import type { InnerWorkerCtx } from './common.js'
import { configureConnection, makeApplyMutation } from './common.js'

export const recreateDb = (workerCtx: Context.Tag.Service<InnerWorkerCtx>) =>
  Effect.gen(function* () {
    const { db, dbLog, sqlite3, schema, bootStatusQueue } = workerCtx

    const migrationOptions = schema.migrationOptions

    yield* Effect.addFinalizer((ex) => {
      if (ex._tag === 'Success') return Effect.void
      return db.destroy.pipe(Effect.tapCauseLogPretty, Effect.orDie)
    })

    // NOTE to speed up the operations below, we're creating a temporary in-memory database
    // and later we'll overwrite the persisted database with the new data
    const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
    tmpDb.capi = sqlite3.capi
    configureConnection(tmpDb, { fkEnabled: true })

    const initDb = (hooks: Partial<MigrationHooks> | undefined) =>
      Effect.gen(function* () {
        const tmpInMemoryDb = makeInMemoryDb(sqlite3, tmpDb)

        yield* Effect.tryAll(() => hooks?.init?.(tmpInMemoryDb)).pipe(UnexpectedError.mapToUnexpectedError)

        yield* migrateDb({
          db: tmpInMemoryDb,
          schema,
          onProgress: ({ done, total }) =>
            Queue.offer(bootStatusQueue, { stage: 'migrating', progress: { done, total } }),
        })

        initializeSingletonTables(schema, tmpInMemoryDb)

        yield* Effect.tryAll(() => hooks?.pre?.(tmpInMemoryDb)).pipe(UnexpectedError.mapToUnexpectedError)

        return tmpInMemoryDb
      })

    const inMemoryDbLog = makeInMemoryDb(sqlite3, dbLog.dbRef.current)

    yield* migrateTable({
      db: inMemoryDbLog,
      behaviour: 'create-if-not-exists',
      tableAst: mutationLogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    switch (migrationOptions.strategy) {
      case 'from-mutation-log': {
        const hooks = migrationOptions.hooks
        const tmpInMemoryDb = yield* initDb(hooks)

        yield* rehydrateFromMutationLog({
          db: tmpInMemoryDb,
          logDb: inMemoryDbLog,
          schema,
          migrationOptions,
          onProgress: ({ done, total }) =>
            Queue.offer(bootStatusQueue, { stage: 'rehydrating', progress: { done, total } }),
        })

        yield* Effect.tryAll(() => hooks?.post?.(tmpInMemoryDb)).pipe(UnexpectedError.mapToUnexpectedError)

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

        importBytesToDb(sqlite3, tmpDb, newDbData)

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

    const snapshotFromTmpDb = tmpDb.capi.sqlite3_js_db_export(tmpDb.pointer!)
    tmpDb.close()

    yield* db.import(snapshotFromTmpDb)

    return snapshotFromTmpDb
  }).pipe(
    Effect.scoped, // NOTE we're closing the scope here so finalizers are called when the effect is done
    Effect.withSpan('@livestore/web:worker:recreateDb'),
    Effect.withPerformanceMeasure('@livestore/web:worker:recreateDb'),
  )

// TODO replace with proper rebasing impl
export const fetchAndApplyRemoteMutations = (
  workerCtx: Context.Tag.Service<InnerWorkerCtx>,
  db: SqliteWasm.Database,
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
      Stream.tap((mutationEventEncoded) =>
        applyMutation(mutationEventEncoded, { syncStatus: 'synced', shouldBroadcast, persisted: true }).pipe(
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
