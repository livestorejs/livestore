import { type StoreAdapter, type StoreAdapterFactory } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'

import { makeInMemoryDb } from './make-in-memory-db.js'
import { importBytesToDb, loadSqlite3Wasm, type SqliteWasm } from './sqlite-utils.js'
import type { MakeCoordinator } from './utils/types.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = loadSqlite3Wasm()

export const makeAdapterFactory =
  (makeCoordinator: MakeCoordinator): StoreAdapterFactory =>
  ({ schema }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      // NOTE Since we're only using SQLite via in-memory, we want to ignore the mainthread+OPFS related warnings here
      // See https://sqlite.org/forum/info/9d4f722c6912799d
      sqlite3.config.warn = () => {}

      const coordinator = yield* makeCoordinator({ schema, sqlite3 }).pipe(Effect.withSpan('coordinator:load'))

      const persistedData = yield* coordinator.getInitialSnapshot.pipe(
        Effect.withSpan('coordinator:getInitialSnapshot'),
      )

      const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & {
        capi: SqliteWasm.CAPI
      }
      db.capi = sqlite3.capi

      importBytesToDb(sqlite3, db, persistedData)

      return { mainDb: makeInMemoryDb(sqlite3, db), coordinator } satisfies StoreAdapter
    })
