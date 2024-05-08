import type { MigrationOptions } from '@livestore/common'
import {
  getExecArgsFromMutation,
  initializeSingletonTables,
  migrateDb,
  migrateTable,
  prepareBindValues,
  rehydrateFromMutationLog,
} from '@livestore/common'
import {
  type LiveStoreSchema,
  makeMutationEventSchema,
  makeSchemaHash,
  MUTATION_LOG_META_TABLE,
  type MutationEventSchema,
  mutationLogMetaTable,
} from '@livestore/common/schema'
import { insertRow } from '@livestore/common/sql-queries'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import sqlite3InitModule from '@livestore/sqlite-wasm'
import { casesHandled, memoize, shouldNeverHappen } from '@livestore/utils'
import { BrowserWorkerRunner, Context, Effect, Layer, Schema, WorkerRunner } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeMainDb } from '../../make-main-db.js'
import { configureConnection } from './common.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import { makePersistedSqlite } from './persisted-sqlite.js'
import type { ExecutionBacklogItem, StorageType } from './schema.js'
import { Request, UnexpectedError } from './schema.js'

const sqlite3Promise = sqlite3InitModule({
  print: (message) => console.log(`[sql-client] ${message}`),
  printErr: (message) => console.error(`[sql-client] ${message}`),
})

export type WorkerOptions<TSchema extends LiveStoreSchema = LiveStoreSchema> = {
  schema: TSchema
  /** "hard-reset" is currently the default strategy */
  migrations?: MigrationOptions<TSchema>
}

export const makeWorker = <TSchema extends LiveStoreSchema = LiveStoreSchema>(options: WorkerOptions<TSchema>) => {
  makeWorkerRunner(options as unknown as WorkerOptions).pipe(
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.runFork,
  )
}

const makeWorkerRunner = ({ schema, migrations = { strategy: 'hard-reset' } }: WorkerOptions) =>
  Effect.gen(function* (_$) {
    const mutationLogExclude =
      migrations.strategy === 'from-mutation-log'
        ? migrations.excludeMutations ?? new Set(['livestore.RawSql'])
        : new Set(['livestore.RawSql'])

    const mutationEventSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const schemaHash = makeSchemaHash(schema)

    return WorkerRunner.layerSerialized(Request, {
      InitialMessage: ({ storage }) =>
        Effect.gen(function* () {
          const sqlite3 = yield* Effect.tryPromise(() => sqlite3Promise)

          const makeDb = makePersistedSqlite({
            storage,
            kind: 'app',
            schemaHash,
            sqlite3,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: true })),
          })

          const makeDbLog = makePersistedSqlite({
            storage,
            kind: 'mutationlog',
            schemaHash,
            sqlite3,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: false })),
          })

          // Might involve some async work, so we're running them concurrently
          const [db, dbLog] = yield* Effect.all([makeDb, makeDbLog], { concurrency: 2 })

          return Layer.succeed(WorkerCtx, {
            storage,
            sqlite3,
            db,
            dbLog,
            mutationDefSchemaHashMap,
            mutationEventSchema,
            mutationLogExclude,
            schema,
          })
        }).pipe(
          Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
          Layer.unwrapScoped,
        ),
      Export: () =>
        Effect.andThen(WorkerCtx, (_) => _.db.export).pipe(
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
        ),
      ExportMutationlog: () =>
        Effect.andThen(WorkerCtx, (_) => _.dbLog.export).pipe(
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
        ),
      ExecuteBulk: ({ items }) =>
        executeBulk(items).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
      Setup: () =>
        Effect.gen(function* () {
          const { db, dbLog, sqlite3 } = yield* WorkerCtx

          yield* Effect.addFinalizer((ex) => {
            if (ex._tag === 'Success') return Effect.void
            return db.destroy.pipe(Effect.orDie)
          })

          const otelContext = otel.context.active()

          // NOTE to speed up the operations below, we're creating a temporary in-memory database
          // and later we'll overwrite the persisted database with the new data
          const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
          tmpDb.capi = sqlite3.capi
          configureConnection(tmpDb, { fkEnabled: true })

          const tmpMainDb = makeMainDb(sqlite3, tmpDb)
          migrateDb({ db: tmpMainDb, otelContext, schema })
          initializeSingletonTables(schema, tmpMainDb)

          const mainDbLog = makeMainDb(sqlite3, dbLog.dbRef.current)

          migrateTable({
            db: mainDbLog,
            behaviour: 'create-if-not-exists',
            tableAst: mutationLogMetaTable.sqliteDef.ast,
            skipMetaTable: true,
          })

          switch (migrations.strategy) {
            case 'from-mutation-log': {
              rehydrateFromMutationLog({ db: tmpMainDb, logDb: mainDbLog, schema })

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
              casesHandled(migrations)
            }
          }

          const snapshotFromTmpDb = tmpDb.capi.sqlite3_js_db_export(tmpDb.pointer!)
          tmpDb.close()

          yield* db.import(snapshotFromTmpDb)

          return snapshotFromTmpDb
        }).pipe(
          Effect.scoped,
          Effect.withPerformanceMeasure('@livestore/web:worker:Setup'),
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
        ),
      Shutdown: () =>
        Effect.gen(function* () {
          // TODO get rid of explicit close calls and rely on the finalizers (by dropping the scope from `InitialMessage`)
          const { db, dbLog } = yield* WorkerCtx
          db.dbRef.current.close()
          dbLog.dbRef.current.close()
        }).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(BrowserWorkerRunner.layer))

class WorkerCtx extends Context.Tag('WorkerCtx')<
  WorkerCtx,
  {
    storage: StorageType
    db: PersistedSqlite
    dbLog: PersistedSqlite
    sqlite3: SqliteWasm.Sqlite3Static

    mutationEventSchema: MutationEventSchema<any>
    mutationLogExclude: ReadonlySet<string>
    mutationDefSchemaHashMap: Map<string, number>
    schema: LiveStoreSchema
  }
>() {}

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const { db, dbLog, mutationEventSchema, mutationLogExclude, mutationDefSchemaHashMap, schema } = yield* WorkerCtx

    const createdAtMemo = memoize(() => new Date().toISOString())

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction
        dbLog.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction

        batchItems = executionItems.slice(offset, offset + 50)
        offset += 50

        // console.debug('livestore-webworker: executing batch', batchItems)

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.dbRef.current.exec({ sql: query, bind: bindValues })

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(item.mutationEventEncoded)

            const mutation = mutationEventDecoded.mutation
            const mutationDef = schema.mutations.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

            const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

            for (const { statementSql, bindValues } of execArgsArr) {
              try {
                // console.debug('livestore-webworker: executing SQL for mutation', mutation, statementSql, bindValues)
                db.dbRef.current.exec({ sql: statementSql, bind: bindValues })
              } catch (e) {
                console.error('Error executing query', e, statementSql, bindValues)
                debugger
                throw e
              }
            }

            // write to mutation_log
            if (
              mutationLogExclude.has(mutation) === false &&
              execArgsArr.some((_) => _.statementSql.includes('__livestore')) === false
            ) {
              const mutationDefSchemaHash =
                mutationDefSchemaHashMap.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

              try {
                const [sql, bind] = insertRow({
                  tableName: MUTATION_LOG_META_TABLE,
                  columns: mutationLogMetaTable.sqliteDef.columns,
                  values: {
                    id: item.mutationEventEncoded.id,
                    mutation: item.mutationEventEncoded.mutation,
                    argsJson: item.mutationEventEncoded.args ?? {},
                    schemaHash: mutationDefSchemaHash,
                    createdAt: createdAtMemo(),
                  },
                })
                dbLog.dbRef.current.exec({ sql, bind: prepareBindValues(bind, sql) })
              } catch (e) {
                console.error(
                  `Error writing to ${MUTATION_LOG_META_TABLE}`,
                  e,
                  item.mutationEventEncoded.id,
                  item.mutationEventEncoded.mutation,
                  item.mutationEventEncoded.args ?? {},
                  mutationDefSchemaHash,
                  createdAtMemo(),
                )
                debugger
                throw e
              }
            } else {
              //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
            }
          } else {
            // TODO handle txn
          }
        }

        db.dbRef.current.exec('COMMIT') // Commit the transaction
        dbLog.dbRef.current.exec('COMMIT') // Commit the transaction
      } catch (error) {
        try {
          db.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
          dbLog.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })
