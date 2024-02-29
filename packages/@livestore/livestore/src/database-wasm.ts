import type * as Sqlite from 'sqlite-esm'
import initSqlite3Wasm from 'sqlite-esm'

import type { DatabaseFactory } from './database.js'
import type { PreparedBindValues } from './utils/util.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

export const makeSqlite3: DatabaseFactory = async (_filename, data) => {
  const sqlite3 = await sqlite3Promise

  const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
  db.capi = sqlite3.capi

  if (data !== undefined) {
    // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
    // TODO find cleaner way to do this once possible in sqlite3-wasm
    const bytes = data
    const p = sqlite3.wasm.allocFromTypedArray(bytes)
    const _rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      p,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    )
  }

  return {
    filename: ':memory:',
    prepare: (value) => {
      const stmt = db.prepare(value)

      return {
        execute: (bindValues) => {
          if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
            stmt.bind(bindValues)
          }

          try {
            stmt.step()
          } finally {
            stmt.reset() // Reset is needed for next execution
          }
        },
        select: <T>(bindValues: PreparedBindValues) => {
          if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
            stmt.bind(bindValues)
          }

          const results: T[] = []

          try {
            // NOTE `getColumnNames` only works for `SELECT` statements, ignoring other statements for now
            let columns = undefined
            try {
              columns = stmt.getColumnNames()
            } catch (_e) {}

            while (stmt.step()) {
              if (columns !== undefined) {
                const obj: { [key: string]: any } = {}
                for (const [i, c] of columns.entries()) {
                  obj[c] = stmt.get(i)
                }
                results.push(obj as unknown as T)
              }
            }
          } finally {
            // reset the cached statement so we can use it again in the future
            stmt.reset()
          }

          return results
        },
        finalize: () => stmt.finalize(),
      }
    },
    export: () => db.capi.sqlite3_js_db_export(db.pointer),
  }
}
