import type { PreparedStatement, SynchronousDatabase } from '@livestore/common'
import Sqlite3 from 'better-sqlite3'
// import { Database } from "bun:sqlite";

export type DbSource =
  | {
      _tag: 'in-memory'
    }
  | {
      _tag: 'file'
      path: string
    }

export namespace DatabaseInterface {
  export type Constructor = (filename?: string) => Database

  export type PreparedStatement = {
    run: (...params: ReadonlyArray<any>) => void
    // bind: {
    // 	(...params: readonly unknown[]): void
    // 	(params: unknown): void
    // }
    all: (...params: ReadonlyArray<any>) => ReadonlyArray<unknown>
    // finalize: () => void
    // sql: string
  }

  export type Database = {
    prepare: (sql: string) => PreparedStatement
    serialize: () => Uint8Array
    close: () => void
  }
}

export const makeSyncDb = (source: DbSource, makeDb: DatabaseInterface.Constructor): SynchronousDatabase => {
  // const db = Sqlite3()
  const db = makeDb(source._tag === 'in-memory' ? ':memory:' : source.path)
  // const db = Sqlite3(source._tag === 'in-memory' ? ':memory:' : source.path)

  const prepare = (sql: string): PreparedStatement => {
    const stmt = db.prepare(sql)
    return {
      execute: (params) => {
        if (params) {
          if (Array.isArray(params)) {
            return stmt.run(...params)
          }
          return stmt.run(params)
        }
        return stmt.run()
      },
      select: (params) => {
        if (params) {
          if (Array.isArray(params)) {
            return stmt.all(...params) as any
          }
          return stmt.all(params)
        }
        return stmt.all()
      },
      finalize: () => {},
      sql,
    }
  }

  return {
    _tag: 'SynchronousDatabase',
    close: () => db.close(),
    execute: (sql, params) => prepare(sql).execute(params),
    select: (sql, params) => prepare(sql).select(params),
    prepare,
    export: () => db.serialize(),
  } satisfies SynchronousDatabase
}
