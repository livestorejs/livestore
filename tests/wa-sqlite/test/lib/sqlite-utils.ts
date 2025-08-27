import * as WaSqlite from '@livestore/wa-sqlite'
import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs'
import { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'
import * as SqliteConstants from '@livestore/wa-sqlite/src/sqlite-constants.js'
import { type PreparedBindValues, SqliteError } from './lib.ts'
export { SqliteConstants }
export { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'
// export { AccessHandlePoolVFS } from '@livestore/wa-sqlite/src/examples/AccessHandlePoolVFS.js'
// export { AccessHandlePoolVFS } from './wa-sqlite/AccessHandlePoolVFS.js'

export const loadSqlite3Wasm = async () => {
  const module = await WaSqliteFactory()
  // https://github.com/rhashimoto/wa-sqlite/issues/143#issuecomment-1899060056
  // module._free(module._malloc(10_000 * 4096 + 65_536))
  const sqlite3 = WaSqlite.Factory(module)
  // @ts-expect-error TODO fix types
  sqlite3.module = module
  return sqlite3
}

export const importBytesToDb = (
  sqlite3: WaSqlite.SQLiteAPI,
  db: number,
  bytes: Uint8Array<ArrayBuffer>,
  readOnly = false,
) => {
  // https://www.sqlite.org/c3ref/c_deserialize_freeonclose.html
  // #define SQLITE_DESERIALIZE_FREEONCLOSE 1 /* Call sqlite3_free() on close */
  // #define SQLITE_DESERIALIZE_RESIZEABLE  2 /* Resize using sqlite3_realloc64() */
  // #define SQLITE_DESERIALIZE_READONLY    4 /* Database is read-only */
  const FREE_ON_CLOSE = 1
  const RESIZEABLE = 2

  if (readOnly === true) {
    sqlite3.deserialize(db, 'main', bytes, bytes.length, bytes.length, FREE_ON_CLOSE | RESIZEABLE)
  } else {
    const tmpDb = makeInMemoryDb(sqlite3)
    // TODO find a way to do this more efficiently with sqlite to avoid either of the deserialize + backup call
    // Maybe this can be done via the VFS API
    sqlite3.deserialize(tmpDb, 'main', bytes, bytes.length, bytes.length, FREE_ON_CLOSE | RESIZEABLE)
    sqlite3.backup(db, 'main', tmpDb, 'main')
    sqlite3.close(tmpDb)
  }
}

export const makeInMemoryDb = (sqlite3: WaSqlite.SQLiteAPI) => {
  if (sqlite3.vfs_registered.has('memory-vfs') === false) {
    // @ts-expect-error TODO fix types
    const vfs = new MemoryVFS('memory-vfs', (sqlite3 as any).module)

    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
  }

  const db = sqlite3.open_v2Sync(':memory:', undefined, 'memory-vfs')

  return db
}

// Enhanced import/export functions (consolidated from import-export-impl.ts)
export const importDb = (sqlite3: WaSqlite.SQLiteAPI, dbPointer: number, source: Uint8Array<ArrayBuffer>) => {
  // https://www.sqlite.org/c3ref/c_deserialize_freeonclose.html
  // #define SQLITE_DESERIALIZE_FREEONCLOSE 1 /* Call sqlite3_free() on close */
  // #define SQLITE_DESERIALIZE_RESIZEABLE  2 /* Resize using sqlite3_realloc64() */
  // #define SQLITE_DESERIALIZE_READONLY    4 /* Database is read-only */
  const FREE_ON_CLOSE = 1
  const RESIZEABLE = 2

  if (source instanceof Uint8Array) {
    const tmpDbPointer = sqlite3.open_v2Sync(':memory:', 0, undefined)
    // TODO find a way to do this more efficiently with sqlite to avoid either of the deserialize + backup call
    // Maybe this can be done via the VFS API
    sqlite3.deserialize(tmpDbPointer, 'main', source, source.length, source.length, FREE_ON_CLOSE | RESIZEABLE)
    sqlite3.backup(dbPointer, 'main', tmpDbPointer, 'main')
    sqlite3.close(tmpDbPointer)
  } else {
    throw new Error('Only Uint8Array source supported')
  }
}

export const exportDb = (sqlite3: WaSqlite.SQLiteAPI, db: number) => {
  return sqlite3.serialize(db, 'main')
}

export const select = (
  sqlite3: WaSqlite.SQLiteAPI,
  dbPointer: number,
  query: string,
  bindValues?: PreparedBindValues,
) => {
  const stmt = prepare(sqlite3, dbPointer, query)
  const results = stmt.select<any>(bindValues ?? {})
  stmt.finalize()
  return results
}

export const exec = (
  sqlite3: WaSqlite.SQLiteAPI,
  dbPointer: number,
  query: string,
  bindValues?: PreparedBindValues,
) => {
  const stmt = prepare(sqlite3, dbPointer, query)
  stmt.execute(bindValues ?? {}, {
    onRowsChanged: (changes: number) => {
      return changes
    },
  })
  stmt.finalize()
}

export const prepare = (sqlite3: WaSqlite.SQLiteAPI, dbPointer: number, queryStr: string) => {
  const stmts = sqlite3.statements(dbPointer, queryStr.trim(), { unscoped: true })

  let isFinalized = false

  const preparedStmt = {
    execute: (bindValues: any, options: any) => {
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
        throw new Error('Expected only one statement when using `select`')
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
  }
  return preparedStmt
}
