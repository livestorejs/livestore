import type { MigrationOptions } from '@livestore/common'
import { getExecArgsFromMutation, initializeSingletonTables, migrateDb, sql } from '@livestore/common'
import {
  type LiveStoreSchema,
  makeMutationEventSchema,
  makeSchemaHash,
  type MutationEventSchema,
} from '@livestore/common/schema'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import sqlite3InitModule from '@livestore/sqlite-wasm'
import { casesHandled, memoize, shouldNeverHappen } from '@livestore/utils'
import { BrowserWorkerRunner, Context, Effect, Layer, Schema, WorkerRunner } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeMainDb } from '../../make-main-db.js'
import { rehydrateFromMutationLog } from '../../rehydrate-from-mutationlog.js'
import { importBytesToDb } from '../utils/sqlite-utils.js'
import {
  configureConnection,
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
  getOpfsDirHandle,
} from './common.js'
import { makePersistedSqliteIndexedDb, makePersistedSqliteOpfs } from './persisted-sqlite.js'
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

    // TODO refactor
    const mutationArgsSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)
    const mutationDefSchemaHashMap = new Map(
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const schemaHash = makeSchemaHash(schema)

    return WorkerRunner.layerSerialized(Request, {
      InitialMessage: ({ storage }) =>
        Effect.gen(function* ($) {
          const sqlite3 = yield* $(Effect.tryPromise(() => sqlite3Promise))

          const makeDb = Effect.gen(function* ($) {
            const db =
              storage.type === 'opfs'
                ? yield* $(
                    makePersistedSqliteOpfs(
                      sqlite3,
                      storage.directory,
                      getAppDbFileName(storage.filePrefix, schemaHash),
                    ),
                  )
                : yield* $(
                    makePersistedSqliteIndexedDb(
                      sqlite3,
                      storage.databaseName ?? 'livestore',
                      getAppDbIdbStoreName(storage.storeNamePrefix, schemaHash),
                    ),
                  )

            configureConnection(db, { fkEnabled: true })

            const dbWasEmptyWhenOpened =
              db.exec({ sql: 'SELECT 1 FROM sqlite_master', returnValue: 'resultRows' }).length === 0

            return { db, dbWasEmptyWhenOpened }
          })

          const makeDbLog = Effect.gen(function* ($) {
            const dbLog =
              storage.type === 'opfs'
                ? yield* $(
                    makePersistedSqliteOpfs(sqlite3, storage.directory, getMutationlogDbFileName(storage.filePrefix)),
                  )
                : yield* $(
                    makePersistedSqliteIndexedDb(
                      sqlite3,
                      storage.databaseName ?? 'livestore',
                      getMutationlogDbIdbStoreName(storage.storeNamePrefix),
                    ),
                  )

            configureConnection(dbLog, { fkEnabled: false })

            // Creates `mutation_log` table if it doesn't exist
            dbLog.exec(sql`
      CREATE TABLE IF NOT EXISTS mutation_log (
        id TEXT PRIMARY KEY NOT NULL,
        mutation TEXT NOT NULL,
        args_json TEXT NOT NULL,
        schema_hash INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

            return dbLog
          })

          const [{ db, dbWasEmptyWhenOpened }, dbLog] = yield* $(Effect.all([makeDb, makeDbLog], { concurrency: 2 }))

          return Layer.succeed(WorkerCtx, {
            storage,
            sqlite3,
            dbRef: { current: db },
            dbWasEmptyWhenOpened,
            dbLog,
          })
        }).pipe(
          Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
          Layer.unwrapScoped,
        ),
      Export: () =>
        Effect.gen(function* ($) {
          const {
            dbRef: { current: db },
          } = yield* $(WorkerCtx)
          return db.capi.sqlite3_js_db_export(db.pointer!)
        }).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
      ExportMutationlog: () =>
        Effect.gen(function* ($) {
          const { dbLog } = yield* $(WorkerCtx)
          return dbLog.capi.sqlite3_js_db_export(dbLog.pointer!)
        }).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
      ExecuteBulk: ({ items }) =>
        executeBulk({
          executionItems: items,
          mutationArgsSchema,
          mutationLogExclude,
          mutationDefSchemaHashMap,
          schema,
        }).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
      Setup: () =>
        Effect.gen(function* ($) {
          const { dbRef, dbWasEmptyWhenOpened, dbLog, sqlite3, storage } = yield* $(WorkerCtx)
          if (dbWasEmptyWhenOpened === false) {
            return dbRef.current.capi.sqlite3_js_db_export(dbRef.current.pointer!)
          }

          const otelContext = otel.context.active()

          // NOTE to speed up the operations below, we're creating a temporary in-memory database
          // and later we'll overwrite the persisted database with the new data
          const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
          tmpDb.capi = sqlite3.capi
          configureConnection(tmpDb, { fkEnabled: true })
          const tmpMainDb = makeMainDb(sqlite3, tmpDb)

          const mainDbLog = makeMainDb(sqlite3, dbLog)

          migrateDb({ db: tmpMainDb, otelContext, schema })

          initializeSingletonTables(schema, tmpMainDb)

          switch (migrations.strategy) {
            case 'from-mutation-log': {
              rehydrateFromMutationLog({
                db: tmpMainDb,
                logDb: mainDbLog,
                schema,
              })

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

          if (storage.type === 'opfs') {
            dbRef.current.close()

            const opfsFileName = getAppDbFileName(storage.filePrefix, schemaHash)

            yield* $(
              Effect.promise(async () => {
                // overwrite the OPFS file with the new data
                const dirHandle = await getOpfsDirHandle(storage.directory)
                const fileHandle = await dirHandle.getFileHandle(opfsFileName, { create: true })
                const writable = await fileHandle.createWritable()
                await writable.write(snapshotFromTmpDb)
                await writable.close()
              }),
            )

            dbRef.current = yield* $(makePersistedSqliteOpfs(sqlite3, storage.directory, opfsFileName))
            configureConnection(dbRef.current, { fkEnabled: true })
          } else if (storage.type === 'indexeddb') {
            importBytesToDb(sqlite3, dbRef.current, snapshotFromTmpDb)

            // trigger persisting the data to IndexedDB
            dbRef.current.exec('SELECT 1')
          }

          return snapshotFromTmpDb
        }).pipe(
          Effect.withPerformanceMeasure('@livestore/web:worker:Setup'),
          Effect.catchAllCause((error) => new UnexpectedError({ error })),
        ),
      Shutdown: ({}) =>
        Effect.gen(function* ($) {
          const { dbRef, dbLog } = yield* $(WorkerCtx)
          dbRef.current.close()
          dbLog.close()
        }).pipe(Effect.catchAllCause((error) => new UnexpectedError({ error }))),
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(BrowserWorkerRunner.layer))

class WorkerCtx extends Context.Tag('WorkerCtx')<
  WorkerCtx,
  {
    storage: StorageType
    /** NOTE We're keeping a ref here since we need to re-assign it during `Setup` */
    dbRef: { current: SqliteWasm.Database & { capi: SqliteWasm.CAPI } }
    dbWasEmptyWhenOpened: boolean

    dbLog: SqliteWasm.Database & { capi: SqliteWasm.CAPI }

    sqlite3: SqliteWasm.Sqlite3Static
  }
>() {}

const executeBulk = ({
  executionItems,
  mutationArgsSchema,
  mutationLogExclude,
  mutationDefSchemaHashMap,
  schema,
}: {
  executionItems: ReadonlyArray<ExecutionBacklogItem>
  mutationArgsSchema: MutationEventSchema<any>
  mutationLogExclude: ReadonlySet<string>
  mutationDefSchemaHashMap: Map<string, number>
  schema: LiveStoreSchema
}) =>
  Effect.gen(function* ($) {
    let batchItems: ExecutionBacklogItem[] = []
    const {
      dbRef: { current: db },
      dbLog,
    } = yield* $(WorkerCtx)

    const createdAtMemo = memoize(() => new Date().toISOString())

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.exec('BEGIN TRANSACTION') // Start the transaction
        dbLog.exec('BEGIN TRANSACTION') // Start the transaction

        batchItems = executionItems.slice(offset, offset + 50)
        offset += 50

        // console.debug('livestore-webworker: executing batch', batchItems)

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.exec({ sql: query, bind: bindValues })

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationEventDecoded = Schema.decodeUnknownSync(mutationArgsSchema)(item.mutationEventEncoded)

            const mutation = mutationEventDecoded.mutation
            const mutationDef = schema.mutations.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

            const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

            for (const { statementSql, bindValues } of execArgsArr) {
              try {
                db.exec({ sql: statementSql, bind: bindValues })
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

              const argsJson = JSON.stringify(item.mutationEventEncoded.args ?? {})

              try {
                dbLog.exec({
                  sql: `INSERT INTO mutation_log (id, mutation, args_json, schema_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
                  bind: [
                    item.mutationEventEncoded.id,
                    item.mutationEventEncoded.mutation,
                    argsJson,
                    mutationDefSchemaHash,
                    createdAtMemo(),
                  ],
                })
              } catch (e) {
                console.error(
                  'Error writing to mutation_log',
                  e,
                  item.mutationEventEncoded.id,
                  item.mutationEventEncoded.mutation,
                  argsJson,
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

        db.exec('COMMIT') // Commit the transaction
        dbLog.exec('COMMIT') // Commit the transaction
      } catch (error) {
        try {
          db.exec('ROLLBACK') // Rollback in case of an error
          dbLog.exec('ROLLBACK') // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })
