import { expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { migrateDb } from '@livestore/common'
import { makeSchema, State, SystemTables } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

Vitest.live('preserves imported snapshots without a rebuild completion marker (#1605)', (test) =>
  Effect.gen(function* () {
    const todos = State.SQLite.table({
      name: 'todos',
      columns: { id: State.SQLite.text({ primaryKey: true }) },
    })
    const schema = makeSchema({
      events: [],
      state: State.SQLite.makeState({ tables: { todos }, materializers: {} }),
    })
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const sourceDb = yield* Effect.acquireRelease(makeSqliteDb({ _tag: 'in-memory' }), (db) =>
      Effect.sync(() => db.close()),
    )

    yield* migrateDb({ db: sourceDb, schema })
    sourceDb.execute(todos.insert({ id: 'imported' }))
    sourceDb.execute(`DROP TABLE ${SystemTables.REBUILD_META_TABLE}`)

    const store = yield* createStore({
      schema,
      adapter: makeInMemoryAdapter({ importSnapshot: sourceDb.export() }),
      storeId: 'import-snapshot-without-completion-marker',
    })

    expect(store.query(todos)).toEqual([{ id: 'imported' }])
  }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
)
