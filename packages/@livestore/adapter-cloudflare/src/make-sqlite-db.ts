import type {
  MakeSqliteDb,
  PersistenceInfo,
  PreparedBindValues,
  PreparedStatement,
  SqliteDb,
  SqliteDbChangeset,
  SqliteDbSession,
} from '@livestore/common'
import { SqliteDbHelper, SqliteError } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { Effect } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'

// Simplified prepared statement implementation using only public API
class CloudflarePreparedStatement implements PreparedStatement {
  private sqlStorage: CfWorker.SqlStorage
  public readonly sql: string

  constructor(sqlStorage: CfWorker.SqlStorage, sql: string) {
    this.sqlStorage = sqlStorage
    this.sql = sql
  }

  execute = (bindValues?: PreparedBindValues, options?: { onRowsChanged?: (count: number) => void }) => {
    try {
      const cursor = this.sqlStorage.exec(this.sql, ...(bindValues ? Object.values(bindValues) : []))

      // Count affected rows by iterating through cursor
      let changedCount = 0
      for (const _row of cursor) {
        changedCount++
      }

      if (options?.onRowsChanged) {
        options.onRowsChanged(changedCount)
      }
    } catch (e) {
      throw new SqliteError({
        query: { bindValues: bindValues ?? {}, sql: this.sql },
        code: (e as any).code ?? -1,
        cause: e,
      })
    }
  }

  select = <T>(bindValues?: PreparedBindValues): readonly T[] => {
    try {
      const cursor = this.sqlStorage.exec<Record<string, CfWorker.SqlStorageValue>>(
        this.sql,
        ...(bindValues ? Object.values(bindValues) : []),
      )
      const results: T[] = []

      for (const row of cursor) {
        results.push(row as T)
      }

      return results
    } catch (e) {
      throw new SqliteError({
        query: { bindValues: bindValues ?? {}, sql: this.sql },
        code: (e as any).code ?? -1,
        cause: e,
      })
    }
  }

  finalize = () => {
    // No-op for public API - statements are automatically cleaned up
  }
}

type Metadata = {
  _tag: 'file'
  dbPointer: number
  persistenceInfo: PersistenceInfo
  input: CloudflareDatabaseInput
  configureDb: (db: SqliteDb) => void
}

type CloudflareDatabaseInput =
  | {
      _tag: 'file'
      // databaseName: string
      // directory: string
      db: CfWorker.SqlStorage
      configureDb: (db: SqliteDb) => void
    }
  | {
      _tag: 'in-memory'
      db: CfWorker.SqlStorage
      configureDb: (db: SqliteDb) => void
    }

export type MakeCloudflareSqliteDb = MakeSqliteDb<Metadata, CloudflareDatabaseInput, { _tag: 'cloudflare' } & Metadata>

export const makeSqliteDb: MakeCloudflareSqliteDb = (input: CloudflareDatabaseInput) =>
  Effect.gen(function* () {
    // console.log('makeSqliteDb', input)
    if (input._tag === 'in-memory') {
      return makeSqliteDb_<Metadata>({
        sqlStorage: input.db,
        metadata: {
          _tag: 'file' as const,
          dbPointer: 0,
          // persistenceInfo: { fileName: ':memory:' },
          persistenceInfo: { fileName: 'cf' },
          input,
          configureDb: input.configureDb,
        },
      }) as any
    }

    if (input._tag === 'file') {
      return makeSqliteDb_<Metadata>({
        sqlStorage: input.db,
        metadata: {
          _tag: 'file' as const,
          dbPointer: 0,
          // persistenceInfo: { fileName: `${input.directory}/${input.databaseName}` },
          persistenceInfo: { fileName: 'cf' },
          input,
          configureDb: input.configureDb,
        },
      }) as any
    }
  })

export const makeSqliteDb_ = <
  TMetadata extends {
    persistenceInfo: PersistenceInfo
    // deleteDb: () => void
    configureDb: (db: SqliteDb<TMetadata>) => void
  },
>({
  sqlStorage,
  metadata,
}: {
  sqlStorage: CfWorker.SqlStorage
  metadata: TMetadata
}): SqliteDb<TMetadata> => {
  const preparedStmts: PreparedStatement[] = []

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
        const preparedStmt = new CloudflarePreparedStatement(sqlStorage, queryStr.trim())
        preparedStmts.push(preparedStmt)
        return preparedStmt
      } catch (e) {
        throw new SqliteError({
          query: { sql: queryStr, bindValues: {} },
          code: (e as any).code ?? -1,
          cause: e,
        })
      }
    },
    export: () => {
      // NOTE: Database export not supported with public API
      // This functionality requires undocumented serialize() method
      // throw new SqliteError({
      //   query: { sql: 'export', bindValues: {} },
      //   code: -1,
      //   cause: 'Database export not supported with public SqlStorage API',
      // })
      return new Uint8Array()
    },
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

      // metadata.deleteDb()
      throw new SqliteError({
        code: -1,
        cause: 'Database destroy not supported with public SqlStorage API',
      })

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

      // NOTE: Database close not supported with public API
      // The database is automatically cleaned up by the runtime
      isClosed = true
    },
    import: (_source) => {
      // NOTE: Database import not supported with public API
      // This functionality requires undocumented deserialize() and backup() methods
      // throw new SqliteError({
      //   query: { sql: 'import', bindValues: {} },
      //   code: -1,
      //   cause: 'Database import not supported with public SqlStorage API',
      // })
    },
    session: () => {
      // NOTE: Session tracking not supported with public API
      // This functionality requires undocumented session_* methods
      // throw new SqliteError({
      //   query: { sql: 'session', bindValues: {} },
      //   code: -1,
      //   cause: 'Session tracking not supported with public SqlStorage API',
      // })
      return {
        changeset: () => new Uint8Array(),
        finish: () => {},
      } satisfies SqliteDbSession
    },
    makeChangeset: (_data) => {
      // NOTE: Changeset operations not supported with public API
      // This functionality requires undocumented changeset_* methods
      const changeset = {
        invert: () => {
          throw new SqliteError({
            code: -1,
            cause: 'Changeset invert not supported with public SqlStorage API',
          })
        },
        apply: () => {
          throw new SqliteError({
            code: -1,
            cause: 'Changeset apply not supported with public SqlStorage API',
          })
        },
      } satisfies SqliteDbChangeset

      return changeset
    },
  } satisfies SqliteDb<TMetadata>

  metadata.configureDb(sqliteDb)

  return sqliteDb
}
