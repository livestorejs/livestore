import {
  type MakeSqliteDb,
  type PersistenceInfo,
  type PreparedStatement,
  type SqliteDb,
  SqliteError,
} from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
// TODO remove `expo-file-system` dependency once expo-sqlite supports `import`
// @ts-expect-error package misses `exports`
import * as ExpoFs from 'expo-file-system/src/next'
// import * as ExpoFs from 'expo-file-system'
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
  const stmts: Set<PreparedStatement> = new Set()
  const dbRef = { current: makeDb(), count: 0 }

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
          finalize: () => {
            dbStmt.finalizeSync()
            stmts.delete(stmt)
          },
          sql: queryStr,
        } satisfies PreparedStatement
        stmts.add(stmt)
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
    destroy: () => {
      if (metadata.input._tag === 'expo') {
        sqliteDb.close()
        SQLite.deleteDatabaseSync(metadata.input.databaseName, metadata.input.directory)
      }
    },
    close: () => {
      try {
        const db = dbRef.current
        for (const stmt of stmts) {
          stmt.finalize()
        }
        stmts.clear()

        db.closeSync()
      } catch (cause) {
        throw new SqliteError({
          cause,
          note: `Error closing database ${metadata.input._tag === 'expo' ? metadata.input.databaseName : 'in-memory'}`,
        })
        // console.error('Error closing database', metadata.input, e, dbCount)
      }
    },
    import: (data) => {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError('importing from an existing database is not yet supported in expo')
      }

      const prevDb = dbRef.current
      for (const stmt of stmts) {
        stmt.finalize()
      }
      stmts.clear()
      prevDb.closeSync()

      if (metadata.input._tag === 'expo') {
        const file = new ExpoFs.File(metadata.input.directory, metadata.input.databaseName)
        file.write(data)

        dbRef.count++
        dbRef.current = makeDb()
      } else {
        dbRef.count++
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
