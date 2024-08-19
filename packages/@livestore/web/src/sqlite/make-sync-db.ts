import { type PreparedBindValues, SqliteError, type SynchronousDatabase } from '@livestore/common'
import * as SqliteConstants from '@livestore/wa-sqlite/src/sqlite-constants.js'

import { exportDb } from './sqlite-utils.js'

export const makeSynchronousDatabase = (sqlite3: SQLiteAPI, db: number): SynchronousDatabase => {
  const syncDb: SynchronousDatabase = {
    _tag: 'SynchronousDatabase',
    prepare: (queryStr) => {
      try {
        const stmts = sqlite3.statements(db, queryStr.trim(), { unscoped: true })

        return {
          execute: (bindValues, options) => {
            for (const stmt of stmts) {
              if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
                sqlite3.bind_collection(stmt, bindValues as any)
              }

              try {
                sqlite3.step(stmt)
              } finally {
                if (options?.onRowsChanged) {
                  options.onRowsChanged(sqlite3.changes(db))
                }

                sqlite3.reset(stmt) // Reset is needed for next execution
              }
            }
          },
          select: <T>(bindValues: PreparedBindValues) => {
            if (stmts.length !== 1) {
              throw new SqliteError({
                query: { bindValues, sql: queryStr },
                code: -1,
                cause: 'Expected only one statement when using `select`',
              })
            }

            const stmt = stmts[0]!

            if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
              sqlite3.bind_collection(stmt, bindValues as any)
            }

            const results: T[] = []

            try {
              // NOTE `column_names` only works for `SELECT` statements, ignoring other statements for now
              let columns = undefined
              try {
                columns = sqlite3.column_names(stmt)
              } catch (_e) {}

              while (sqlite3.step(stmt) === SqliteConstants.SQLITE_ROW) {
                if (columns !== undefined) {
                  const obj: { [key: string]: any } = {}
                  for (let i = 0; i < columns.length; i++) {
                    obj[columns[i]!] = sqlite3.column(stmt, i)
                  }
                  results.push(obj as unknown as T)
                }
              }
            } catch (e) {
              throw new SqliteError({
                query: { bindValues, sql: queryStr },
                code: (e as any).code,
                cause: e,
              })
            } finally {
              // reset the cached statement so we can use it again in the future
              sqlite3.reset(stmt)
            }

            return results
          },
          finalize: () => {
            for (const stmt of stmts) {
              sqlite3.finalize(stmt)
            }
          },
        }
      } catch (e) {
        throw new SqliteError({
          query: { sql: queryStr, bindValues: {} },
          code: (e as any).code,
          cause: e,
        })
      }
    },
    export: () => exportDb(sqlite3, db),
    execute: (queryStr, bindValues, options) => {
      const stmt = syncDb.prepare(queryStr)
      stmt.execute(bindValues, options)
      stmt.finalize()
    },
    select: (queryStr, bindValues) => {
      const stmt = syncDb.prepare(queryStr)
      const results = stmt.select(bindValues)
      stmt.finalize()
      return results as ReadonlyArray<any>
    },
  } satisfies SynchronousDatabase

  return syncDb
}
