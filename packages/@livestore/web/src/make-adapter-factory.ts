import { type StoreAdapter, type StoreAdapterFactory } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'

import { makeInMemoryDb } from './make-in-memory-db.js'
import { importBytesToDb, loadSqlite3Wasm, type SqliteWasm } from './sqlite-utils.js'
import type { MakeCoordinator } from './utils/types.js'

// NOTE Since we're only using SQLite via in-memory, we want to ignore the mainthread+OPFS related warnings here
// See https://sqlite.org/forum/info/9d4f722c6912799d and https://github.com/sqlite/sqlite-wasm/issues/62
// @ts-expect-error Missing types
globalThis.sqlite3ApiConfig = {
  warn: () => {},
}

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = loadSqlite3Wasm()

export const makeAdapterFactory =
  (makeCoordinator: MakeCoordinator): StoreAdapterFactory =>
  ({ schema, devtoolsEnabled, bootStatusQueue, shutdown }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      const coordinator = yield* makeCoordinator({
        schema,
        sqlite3,
        devtoolsEnabled,
        bootStatusQueue,
        shutdown,
      }).pipe(Effect.withSpan('@livestore/web:coordinator:load'))

      const persistedData = yield* coordinator.getInitialSnapshot.pipe(
        Effect.withSpan('@livestore/web:coordinator:getInitialSnapshot'),
      )

      const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & {
        capi: SqliteWasm.CAPI
      }
      db.capi = sqlite3.capi

      importBytesToDb(sqlite3, db, persistedData)

      const mainDb = makeInMemoryDb(sqlite3, db)

      return { mainDb, coordinator } satisfies StoreAdapter
    })
