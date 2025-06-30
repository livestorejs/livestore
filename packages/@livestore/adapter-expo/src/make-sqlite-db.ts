import {
  type MakeSqliteDb,
  type PersistenceInfo,
  type PreparedStatement,
  type SqliteDb,
  SqliteDbHelper,
  SqliteError,
} from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
// TODO remove `expo-file-system` dependency once expo-sqlite supports `import`
// // @ts-expect-error package misses `exports`
// import * as ExpoFs from 'expo-file-system/src/next'
// import * as ExpoFs from 'expo-file-system'
import * as SQLite from 'expo-sqlite'

type Metadata = {
  _tag: 'file'
  dbPointer: number
  persistenceInfo: PersistenceInfo
  input: ExpoDatabaseInput
}

type ExpoDatabaseInput =
  | {
      _tag: 'file'
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
      const db = SQLite.openDatabaseSync(':memory:')

      return makeSqliteDb_({
        db,
        metadata: {
          _tag: 'file',
          dbPointer: 0,
          persistenceInfo: { fileName: ':memory:' },
          input,
        },
      }) as any
    }

    if (input._tag === 'file') {
      const db = SQLite.openDatabaseSync(input.databaseName, {}, input.directory)

      return makeSqliteDb_({
        db,
        metadata: {
          _tag: 'file',
          dbPointer: 0,
          persistenceInfo: { fileName: `${input.directory}/${input.databaseName}` },
          input,
        },
      }) as any
    }
  })

const makeSqliteDb_ = <TMetadata extends Metadata>({
  db,
  metadata,
}: {
  db: SQLite.SQLiteDatabase
  metadata: TMetadata
}): SqliteDb<TMetadata> => {
  const stmts: Set<PreparedStatement> = new Set()

  const sqliteDb: SqliteDb<TMetadata> = {
    metadata,
    _tag: 'SqliteDb',
    debug: {
      // Setting initially to root but will be set to correct value shortly after
      head: EventSequenceNumber.ROOT,
    },
    prepare: (queryStr) => {
      try {
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
    execute: SqliteDbHelper.makeExecute((queryStr, bindValues) => {
      const stmt = db.prepareSync(queryStr)
      try {
        const res = stmt.executeSync(bindValues ?? ([] as any))
        return () => res.changes
      } finally {
        stmt.finalizeSync()
      }
    }),
    export: () => {
      return db.serializeSync()
    },
    select: SqliteDbHelper.makeSelect((queryStr, bindValues) => {
      const stmt = sqliteDb.prepare(queryStr)
      const res = stmt.select(bindValues)
      stmt.finalize()
      return res as any
    }),
    destroy: () => {
      sqliteDb.close()

      if (metadata.input._tag === 'file') {
        SQLite.deleteDatabaseSync(metadata.input.databaseName, metadata.input.directory)
      }
    },
    close: () => {
      try {
        for (const stmt of stmts) {
          stmt.finalize()
        }
        stmts.clear()

        db.closeSync()
      } catch (cause) {
        throw new SqliteError({
          cause,
          note: `Error closing database ${metadata.input._tag === 'file' ? metadata.input.databaseName : 'in-memory'}`,
        })
        // console.error('Error closing database', metadata.input, e, dbCount)
      }
    },
    import: (data) => {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError('importing from an existing database is not yet supported in expo')
      }

      try {
        const tmpDb = SQLite.deserializeDatabaseSync(data)
        SQLite.backupDatabaseSync({ sourceDatabase: tmpDb, destDatabase: db })
        tmpDb.closeSync()
      } catch (cause) {
        throw new SqliteError({
          cause,
          note: `Error importing database ${metadata.input._tag === 'file' ? metadata.input.databaseName : 'in-memory'}`,
        })
      }
    },
    session: () => {
      const session = db.createSessionSync()
      session.attachSync(null)
      return {
        changeset: () => session.createChangesetSync(),
        finish: () => session.closeSync(),
      }
    },
    makeChangeset: (data) => {
      const session = db.createSessionSync()
      // NOTE we're not actually attaching this particular session as we only need it to create and
      // apply an inverted changeset
      return {
        invert: () => {
          const inverted = session.invertChangesetSync(data)
          return sqliteDb.makeChangeset(inverted)
        },
        apply: () => {
          session.applyChangesetSync(data)
        },
      }
    },
  } satisfies SqliteDb

  return sqliteDb
}
