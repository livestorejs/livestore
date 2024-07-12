import { initializeSingletonTables, migrateDb, migrateTable, rehydrateFromMutationLog } from '@livestore/common'
import { mutationLogMetaTable } from '@livestore/common/schema'
import { casesHandled, memoizeByStringifyArgs } from '@livestore/utils'
import type { Context } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeInMemoryDb } from '../make-in-memory-db.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import type { WorkerCtx } from './common.js'
import { configureConnection, makeApplyMutation } from './common.js'

export const recreateDb = (workerCtx: Context.Tag.Service<WorkerCtx>) =>
  Effect.gen(function* () {
    const { schema } = workerCtx
    const { db, dbLog, sqlite3 } = workerCtx.ctx

    const migrationOptions = schema.migrationOptions
    const hooks = migrationOptions.hooks

    yield* Effect.addFinalizer((ex) => {
      if (ex._tag === 'Success') return Effect.void
      return db.destroy.pipe(Effect.tapCauseLogPretty, Effect.orDie)
    })

    const otelContext = otel.context.active()

    // NOTE to speed up the operations below, we're creating a temporary in-memory database
    // and later we'll overwrite the persisted database with the new data
    const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
    tmpDb.capi = sqlite3.capi
    configureConnection(tmpDb, { fkEnabled: true })

    const tmpInMemoryDb = makeInMemoryDb(sqlite3, tmpDb)

    if (hooks?.init !== undefined) {
      yield* Effect.promise(async () => hooks.init!(tmpInMemoryDb))
    }

    migrateDb({ db: tmpInMemoryDb, otelContext, schema })
    initializeSingletonTables(schema, tmpInMemoryDb)

    if (hooks?.pre !== undefined) {
      yield* Effect.promise(async () => hooks.pre!(tmpInMemoryDb))
    }

    const inMemoryDbLog = makeInMemoryDb(sqlite3, dbLog.dbRef.current)

    migrateTable({
      db: inMemoryDbLog,
      behaviour: 'create-if-not-exists',
      tableAst: mutationLogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    switch (migrationOptions.strategy) {
      case 'from-mutation-log': {
        yield* Effect.promise(() =>
          rehydrateFromMutationLog({ db: tmpInMemoryDb, logDb: inMemoryDbLog, schema, migrationOptions }),
        )

        break
      }
      case 'hard-reset': {
        // This is already the case by note doing anything now

        break
      }
      case 'manual': {
        // const migrateFn = migrationStrategy.migrate
        console.warn('Manual migration strategy not implemented yet')

        // TODO figure out a way to get previous database file to pass to the migration function

        break
      }
      default: {
        casesHandled(migrationOptions)
      }
    }

    if (hooks?.post !== undefined) {
      yield* Effect.promise(async () => hooks.post!(tmpInMemoryDb))
    }

    yield* fetchAndApplyRemoteMutations(workerCtx, tmpDb, false)

    const snapshotFromTmpDb = tmpDb.capi.sqlite3_js_db_export(tmpDb.pointer!)
    tmpDb.close()

    yield* db.import(snapshotFromTmpDb)

    return snapshotFromTmpDb
  }).pipe(Effect.scoped, Effect.withPerformanceMeasure('@livestore/web:worker:Setup'))

// TODO replace with proper rebasing impl
export const fetchAndApplyRemoteMutations = (
  workerCtx: Context.Tag.Service<WorkerCtx>,
  db: SqliteWasm.Database,
  shouldBroadcast: boolean,
) =>
  Effect.gen(function* () {
    if (workerCtx.ctx.sync === undefined) return
    const { sync } = workerCtx.ctx

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = makeApplyMutation(workerCtx, createdAtMemo, db)

    // TODO stash and rebase local mutations on top of remote mutations
    // probably using the SQLite session extension
    yield* sync.inititialMessages.pipe(
      Stream.tapSync((mutationEventEncoded) =>
        applyMutation(mutationEventEncoded, { syncStatus: 'synced', shouldBroadcast, persisted: true }),
      ),
      Stream.runDrain,
    )
  })
