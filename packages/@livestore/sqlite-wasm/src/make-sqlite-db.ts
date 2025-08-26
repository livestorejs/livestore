import type {
  PersistenceInfo,
  PreparedBindValues,
  PreparedStatement,
  SqliteDb,
  SqliteDbChangeset,
} from '@livestore/common'
import { SqliteDbHelper, SqliteError } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import type { SQLiteAPI } from '@livestore/wa-sqlite'
import * as SqliteConstants from '@livestore/wa-sqlite/src/sqlite-constants.js'
import { makeInMemoryDb } from './in-memory-vfs.ts'

export const makeSqliteDb = <
  TMetadata extends {
    dbPointer: number
    persistenceInfo: PersistenceInfo
    deleteDb: () => void
    configureDb: (db: SqliteDb<TMetadata>) => void
  },
>({
  sqlite3,
  metadata,
}: {
  sqlite3: SQLiteAPI
  metadata: TMetadata
}): SqliteDb<TMetadata> => {
  const preparedStmts: PreparedStatement[] = []
  const { dbPointer } = metadata

  let isClosed = false

  const sqliteDb: SqliteDb<TMetadata> = {
    _tag: 'SqliteDb',
    metadata,
    debug: {
      // Setting initially to root but will be set to correct value shortly after
      head: EventSequenceNumber.ROOT,
    },
    prepare: (queryStr) => {
      try {
        const stmts = sqlite3.statements(dbPointer, queryStr.trim(), { unscoped: true })

        let isFinalized = false

        const preparedStmt = {
          execute: (bindValues, options) => {
            for (const stmt of stmts) {
              if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
                sqlite3.bind_collection(stmt, bindValues as any)
              }

              try {
                sqlite3.step(stmt)
              } finally {
                if (options?.onRowsChanged) {
                  options.onRowsChanged(sqlite3.changes(dbPointer))
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
              let columns: string[] | undefined
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
            // Avoid double finalization which leads to a crash
            if (isFinalized) {
              return
            }

            isFinalized = true

            for (const stmt of stmts) {
              sqlite3.finalize(stmt)
            }
          },
          sql: queryStr,
        } satisfies PreparedStatement

        preparedStmts.push(preparedStmt)

        return preparedStmt
      } catch (e) {
        throw new SqliteError({
          query: { sql: queryStr, bindValues: {} },
          code: (e as any).code,
          cause: e,
        })
      }
    },
    export: SqliteDbHelper.makeExport(() => sqlite3.serialize(dbPointer, 'main')),
    execute: SqliteDbHelper.makeExecute((queryStr, bindValues, options) => {
      const stmt = sqliteDb.prepare(queryStr)
      stmt.execute(bindValues, options)
      stmt.finalize()
    }),
    select: SqliteDbHelper.makeSelect((queryStr, bindValues) => {
      const stmt = sqliteDb.prepare(queryStr)
      const results = stmt.select(bindValues)
      stmt.finalize()
      return results as ReadonlyArray<any>
    }),
    destroy: () => {
      sqliteDb.close()

      metadata.deleteDb()
      // if (metadata._tag === 'opfs') {
      //   metadata.vfs.resetAccessHandle(metadata.fileName)
      // }
    },
    close: () => {
      if (isClosed) {
        return
      }

      for (const stmt of preparedStmts) {
        stmt.finalize()
      }
      sqlite3.close(dbPointer)
      isClosed = true
    },
    import: (source) => {
      // https://www.sqlite.org/c3ref/c_deserialize_freeonclose.html
      // #define SQLITE_DESERIALIZE_FREEONCLOSE 1 /* Call sqlite3_free() on close */
      // #define SQLITE_DESERIALIZE_RESIZEABLE  2 /* Resize using sqlite3_realloc64() */
      // #define SQLITE_DESERIALIZE_READONLY    4 /* Database is read-only */
      const FREE_ON_CLOSE = 1
      const RESIZEABLE = 2

      // NOTE in case we'll have a future use-case where we need a read-only database, we can reuse this code below
      // if (readOnly === true) {
      //   sqlite3.deserialize(db, 'main', bytes, bytes.length, bytes.length, FREE_ON_CLOSE | RESIZEABLE)
      // } else {
      if (source instanceof Uint8Array) {
        const tmpDb = makeInMemoryDb(sqlite3)
        // TODO find a way to do this more efficiently with sqlite to avoid either of the deserialize + backup call
        // Maybe this can be done via the VFS API
        sqlite3.deserialize(tmpDb.dbPointer, 'main', source, source.length, source.length, FREE_ON_CLOSE | RESIZEABLE)
        sqlite3.backup(dbPointer, 'main', tmpDb.dbPointer, 'main')
        sqlite3.close(tmpDb.dbPointer)
      } else {
        sqlite3.backup(dbPointer, 'main', source.metadata.dbPointer, 'main')
      }

      metadata.configureDb(sqliteDb)
    },
    session: () => {
      const sessionPointer = sqlite3.session_create(dbPointer, 'main')
      sqlite3.session_attach(sessionPointer, null)

      return {
        changeset: () => {
          const res = sqlite3.session_changeset(sessionPointer)
          return res.changeset ?? undefined
        },
        finish: () => {
          sqlite3.session_delete(sessionPointer)
        },
      }
    },
    makeChangeset: (data) => {
      const changeset = {
        invert: () => {
          const inverted = sqlite3.changeset_invert(data)
          return sqliteDb.makeChangeset(inverted)
        },
        apply: () => {
          try {
            sqlite3.changeset_apply(dbPointer, data)
            // @ts-expect-error data should be garbage collected after use
            // biome-ignore lint/style/noParameterAssign: ...
            data = undefined
          } catch (cause: any) {
            throw new SqliteError({
              code: cause.code ?? -1,
              cause,
              note: `Failed calling makeChangeset.apply`,
            })
          }
        },
      } satisfies SqliteDbChangeset

      return changeset
    },
  } satisfies SqliteDb<TMetadata>

  metadata.configureDb(sqliteDb)

  return sqliteDb
}
