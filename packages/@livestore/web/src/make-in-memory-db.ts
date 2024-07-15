import type { GetRowsChangedCount, InMemoryDatabase, PreparedBindValues } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'

import type { SqliteWasm } from './sqlite-utils.js'

export const makeInMemoryDb = (
  sqlite3: SqliteWasm.Sqlite3Static,
  db: SqliteWasm.Database & { capi: SqliteWasm.CAPI },
): InMemoryDatabase => {
  return {
    _tag: 'InMemoryDatabase',
    prepare: (queryStr) => {
      try {
        const stmt = db.prepare(queryStr)

        return {
          execute: (bindValues) => {
            if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
              stmt.bind(bindValues)
            }

            let res: GetRowsChangedCount

            try {
              stmt.step()
            } finally {
              stmt.reset() // Reset is needed for next execution
              res = () => sqlite3.capi.sqlite3_changes(db)
            }

            return res
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
            } catch (e) {
              console.error(e)
              shouldNeverHappen(`Error while executing query ${queryStr}`)
            } finally {
              // reset the cached statement so we can use it again in the future
              stmt.reset()
            }

            return results
          },
          finalize: () => stmt.finalize(),
        }
      } catch (e) {
        console.error(e)
        return shouldNeverHappen(`Error while preparing query ${queryStr}`)
      }
    },
    export: () => db.capi.sqlite3_js_db_export(db.pointer!),
    execute: (queryStr, bindValues) => {
      const stmt = db.prepare(queryStr)

      if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
        stmt.bind(bindValues)
      }

      let res: GetRowsChangedCount

      try {
        stmt.step()
      } finally {
        stmt.finalize()
        res = () => sqlite3.capi.sqlite3_changes(db)
      }

      return res
    },
    // dangerouslyReset: async () => {
    //   db.capi.sqlite3_close_v2(db.pointer!)

    //   db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
    // },
  } satisfies InMemoryDatabase
}
