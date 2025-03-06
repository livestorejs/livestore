import type { MakeSqliteDb, PersistenceInfo, PreparedStatement, SqliteDb } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite'

type Metadata = {
  _tag: 'expo'
  dbPointer: number
  persistenceInfo: PersistenceInfo
  input: ExpoDatabaseInput
}

type ExpoDatabaseInput =
  | {
      _tag: 'expo'
      databaseName: string
      directory: string
    }
  | {
      _tag: 'in-memory'
    }

export type MakeExpoSqliteDb = MakeSqliteDb<Metadata, ExpoDatabaseInput, { _tag: 'expo' } & Metadata>

export const makeSqliteDb: MakeExpoSqliteDb = (input: ExpoDatabaseInput) =>
  Effect.gen(function* () {
    // console.log('makeSqliteDb', input)
    if (input._tag === 'in-memory') {
      // const db = SQLite.openDatabaseSync(':memory:')

      return makeSqliteDb_({
        // db,
        makeDb: () => SQLite.openDatabaseSync(':memory:'),
        metadata: {
          _tag: 'expo',
          dbPointer: 0,
          persistenceInfo: { fileName: ':memory:' },
          input,
        },
      }) as any
    }

    if (input._tag === 'expo') {
      // const db = SQLite.openDatabaseSync(input.databaseName, {}, input.directory)

      return makeSqliteDb_({
        // db,
        makeDb: () => SQLite.openDatabaseSync(input.databaseName, {}, input.directory),
        metadata: {
          _tag: 'expo',
          dbPointer: 0,
          persistenceInfo: { fileName: `${input.directory}/${input.databaseName}` },
          input,
        },
      }) as any
    }
  })

const makeSqliteDb_ = <TMetadata extends Metadata>({
  // db,
  makeDb,
  metadata,
}: {
  // db: SQLite.SQLiteDatabase
  makeDb: () => SQLite.SQLiteDatabase
  metadata: TMetadata
}): SqliteDb<TMetadata> => {
  const stmts: PreparedStatement[] = []
  const dbRef = { current: makeDb() }

  const sqliteDb: SqliteDb<TMetadata> = {
    metadata,
    _tag: 'SqliteDb',
    prepare: (queryStr) => {
      try {
        const db = dbRef.current
        const dbStmt = db.prepareSync(queryStr)
        const stmt = {
          execute: (bindValues) => {
            // console.log('execute', queryStr, bindValues)
            const res = dbStmt.executeSync(bindValues ?? ([] as any))
            res.resetSync()
            return () => res.changes
          },
          select: (bindValues) => {
            const res = dbStmt.executeSync(bindValues ?? ([] as any))
            try {
              return res.getAllSync() as any
            } finally {
              res.resetSync()
            }
          },
          finalize: () => dbStmt.finalizeSync(),
          sql: queryStr,
        } satisfies PreparedStatement
        stmts.push(stmt)
        return stmt
      } catch (e) {
        console.error(`Error preparing statement: ${queryStr}`, e)
        return shouldNeverHappen(`Error preparing statement: ${queryStr}`)
      }
    },
    execute: (queryStr, bindValues) => {
      const db = dbRef.current
      const stmt = db.prepareSync(queryStr)
      try {
        const res = stmt.executeSync(bindValues ?? ([] as any))
        return () => res.changes
      } finally {
        stmt.finalizeSync()
      }
    },
    export: () => {
      const db = dbRef.current
      return db.serializeSync()
    },
    select: (queryStr, bindValues) => {
      const stmt = sqliteDb.prepare(queryStr)
      const res = stmt.select(bindValues)
      stmt.finalize()
      return res as any
    },
    // TODO
    destroy: () => {
      if (metadata.input._tag === 'expo') {
        SQLite.deleteDatabaseSync(metadata.input.databaseName, metadata.input.directory)
      }
    },
    close: () => {
      const db = dbRef.current
      for (const stmt of stmts) {
        stmt.finalize()
      }
      return db.closeSync()
    },
    import: (data) => {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError('importing from an existing database is not yet supported in expo')
      }
      if (metadata.input._tag === 'expo') {
        throw new Error('not implemented')
        // SQLite.importDatabaseSync(metadata.input.databaseName, metadata.input.directory, _data)
      } else {
        dbRef.current.closeSync()
        dbRef.current = SQLite.deserializeDatabaseSync(data)
      }
    },
    session: () => {
      return {
        changeset: () => new Uint8Array(),
        finish: () => {},
      }
    },
    makeChangeset: (data) => {
      return {
        invert: () => {
          return sqliteDb.makeChangeset(data)
        },
        apply: () => {
          // TODO
        },
      }
    },
  } satisfies SqliteDb

  return sqliteDb
}
