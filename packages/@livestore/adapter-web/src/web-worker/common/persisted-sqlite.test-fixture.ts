import { migrateDb } from '@livestore/common'
import { configureConnection } from '@livestore/common/leader-thread'
import { makeSchema, State, SystemTables } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { Effect } from '@livestore/utils/effect'
import { Opfs } from '@livestore/utils/effect/browser'

import { getStateDbFileName, readPersistedStateDbFromClientSession, sanitizeOpfsDir } from './persisted-sqlite.ts'

/** Exercise the browser snapshot reader against a real AccessHandlePoolVFS file. */
const run = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = sqliteDbFactory({ sqlite3 })
  const services = yield* Effect.context()
  const storeId = `rebuild-snapshot-${crypto.randomUUID()}`
  const storageOptions = { type: 'opfs' as const }
  const todos = State.SQLite.table({ name: 'todos', columns: { id: State.SQLite.text({ primaryKey: true }) } })
  const schema = makeSchema({ events: [], state: State.SQLite.makeState({ tables: { todos }, materializers: {} }) })
  const persisted = yield* Effect.acquireRelease(
    makeSqliteDb({
      _tag: 'opfs',
      opfsDirectory: yield* sanitizeOpfsDir(undefined, storeId),
      fileName: getStateDbFileName(schema),
      configureDb: (db) => configureConnection(db, { foreignKeys: true }).pipe(Effect.runSyncWith(services)),
    }),
    (db) => Effect.sync(() => db.close()),
  )
  const closeCounts: number[] = []
  const makeSnapshotDb = (input: { _tag: 'in-memory' }) =>
    makeSqliteDb(input).pipe(
      Effect.map((db) => {
        const index = closeCounts.push(0) - 1
        return {
          ...db,
          close: () => {
            closeCounts[index] = (closeCounts[index] ?? 0) + 1
            db.close()
          },
        }
      }),
    )
  yield* migrateDb({ db: persisted, schema })
  persisted.execute(todos.insert({ id: 'partial' }))
  const read = readPersistedStateDbFromClientSession({ storeId, storageOptions, schema, makeSqliteDb: makeSnapshotDb })
  const readStatus = read.pipe(Effect.match({ onSuccess: () => 'accepted', onFailure: (error) => error._tag }))
  const incomplete = yield* readStatus
  persisted.execute(`DROP TABLE ${SystemTables.REBUILD_META_TABLE}`)
  const missingMarkerTable = yield* readStatus
  yield* migrateDb({ db: persisted, schema })
  persisted.execute(todos.insert({ id: 'complete' }))
  persisted.execute(`INSERT INTO ${SystemTables.REBUILD_META_TABLE} (id) VALUES (1)`)
  const { sqliteDb } = yield* read
  return {
    incomplete,
    missingMarkerTable,
    complete: 'accepted',
    rows: sqliteDb.select(todos.orderBy('id', 'asc')),
    // Check before the outer scope closes: rejection must release memory immediately.
    closeCountsBeforeScopeExit: [...closeCounts],
    closeCountsAfterScopeExit: closeCounts,
  }
}).pipe(Effect.scoped, Effect.provide(Opfs.layer))

void Effect.runPromise(run).then(
  (result) => postMessage({ result }),
  (error) => postMessage({ error: String(error) }),
)
