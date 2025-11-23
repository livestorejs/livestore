import type { MakeSqliteDb, PersistenceInfo, SqliteDb } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { Effect, Hash, Runtime, type Scope } from '@livestore/utils/effect'
import type { Opfs } from '@livestore/utils/effect/browser'
import type { SQLiteAPI } from '@livestore/wa-sqlite'
import type { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'

import { makeInMemoryDb } from '../in-memory-vfs.ts'
import { makeSqliteDb } from '../make-sqlite-db.ts'
import type { VfsBackend } from '../vfs/VfsBackend.ts'
import { makeOpfsDb, type OpfsPool, type OpfsPoolShape } from './opfs/index.ts'

export * from './opfs/opfs-sah-pool.ts'

type WebDatabaseReq = {
  dbPointer: number
  persistenceInfo: PersistenceInfo
}

export type WebDatabaseMetadataInMemory = {
  _tag: 'in-memory'
  vfs: MemoryVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo
  deleteDb: () => void
  configureDb: (db: SqliteDb) => void
}

export type WebDatabaseMetadataOpfs = {
  _tag: 'opfs'
  pool: OpfsPoolShape
  dbPointer: number
  persistenceInfo: PersistenceInfo<{
    opfsDirectory: string
    /** Actual filename used by OPFS */
    opfsFileName: string
  }>
  deleteDb: () => void
  configureDb: (db: SqliteDb) => void
}

export type WebDatabaseMetadata = WebDatabaseMetadataInMemory | WebDatabaseMetadataOpfs

export type WebDatabaseInputInMemory = {
  _tag: 'in-memory'
  configureDb?: (db: SqliteDb) => void
}

export type WebDatabaseInputOpfs = {
  _tag: 'opfs'
  /** Filename of the database file (only used when exporting/downloading the database) */
  fileName: string
  opfsDirectory: string
  configureDb?: (db: SqliteDb) => void
}

type MakeInMemoryWebDatabase = MakeSqliteDb<WebDatabaseReq, WebDatabaseInputInMemory, WebDatabaseMetadataInMemory>

type MakeOpfsWebDatabase = MakeSqliteDb<
  WebDatabaseReq,
  WebDatabaseInputOpfs,
  WebDatabaseMetadataOpfs,
  VfsBackend | OpfsPool | Scope.Scope
>

export function sqliteDbFactory({ sqlite3 }: { sqlite3: SQLiteAPI }) {
  function makeDb(input: WebDatabaseInputInMemory): ReturnType<MakeInMemoryWebDatabase>
  function makeDb(input: WebDatabaseInputOpfs): ReturnType<MakeOpfsWebDatabase>
  function makeDb(
    input: WebDatabaseInputInMemory | WebDatabaseInputOpfs,
  ): ReturnType<
    MakeSqliteDb<
      WebDatabaseReq,
      WebDatabaseInputInMemory | WebDatabaseInputOpfs,
      WebDatabaseMetadata,
      VfsBackend | OpfsPool | Scope.Scope
    >
  > {
    return Effect.gen(function* () {
      if (input._tag === 'in-memory') {
        const { dbPointer, vfs } = makeInMemoryDb(sqlite3)
        return makeSqliteDb<WebDatabaseMetadataInMemory>({
          sqlite3,
          metadata: {
            _tag: 'in-memory',
            vfs,
            dbPointer,
            deleteDb: () => {},
            configureDb: input.configureDb ?? (() => {}),
            persistenceInfo: {
              fileName: ':memory:',
            },
          },
        })
      }

      // TODO figure out the actual max length
      const MAX_DB_FILENAME_LENGTH = 60

      let dbFilename = input.fileName

      if (input.fileName.length > MAX_DB_FILENAME_LENGTH) {
        yield* Effect.logWarning(
          `dbFilename too long: '${input.fileName}'. Max ${MAX_DB_FILENAME_LENGTH} chars, got ${input.fileName.length}. Hashing...`,
        )
        dbFilename = `hash-${Hash.string(input.fileName)}.db`
      }

      const { dbPointer, pool } = yield* makeOpfsDb({
        sqlite3,
        directory: input.opfsDirectory,
        fileName: dbFilename,
      })

      const runtime = yield* Effect.runtime()
      const opfsFileName = yield* pool.getOpfsFileName(dbFilename)

      return makeSqliteDb<WebDatabaseMetadataOpfs>({
        sqlite3,
        metadata: {
          _tag: 'opfs',
          pool,
          dbPointer,
          deleteDb: () => pool.resetAccessHandle(dbFilename).pipe(Runtime.runSync(runtime)),
          configureDb: input.configureDb ?? (() => {}),
          persistenceInfo: {
            fileName: dbFilename,
            opfsDirectory: input.opfsDirectory,
            opfsFileName,
          },
        },
      })
    }).pipe(UnexpectedError.mapToUnexpectedError)
  }

  return makeDb
}

export type MakeWebSqliteDb = ReturnType<typeof sqliteDbFactory>
