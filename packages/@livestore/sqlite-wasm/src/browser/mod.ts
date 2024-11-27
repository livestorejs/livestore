import type { MakeSynchronousDatabase, PersistenceInfo, SynchronousDatabase } from '@livestore/common'
import { Effect, Hash } from '@livestore/utils/effect'
import type { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'

import { makeInMemoryDb } from '../in-memory-vfs.js'
import { makeSynchronousDatabase } from '../make-sync-db.js'
import type { AccessHandlePoolVFS } from './opfs/AccessHandlePoolVFS.js'
import { makeOpfsDb } from './opfs/index.js'

export * from './opfs/opfs-sah-pool.js'

export type WebDatabaseMetadataInMemory = {
  _tag: 'in-memory'
  vfs: MemoryVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo
  deleteDb: () => void
  configureDb: (db: SynchronousDatabase) => void
}

export type WebDatabaseMetadataOpfs = {
  _tag: 'opfs'
  vfs: AccessHandlePoolVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo<{
    opfsDirectory: string
    /** Actual filename used by OPFS */
    opfsFileName: string
  }>
  deleteDb: () => void
  configureDb: (db: SynchronousDatabase) => void
}

export type WebDatabaseMetadata = WebDatabaseMetadataInMemory | WebDatabaseMetadataOpfs

export type WebDatabaseInputInMemory = {
  _tag: 'in-memory'
  configureDb?: (db: SynchronousDatabase) => void
}

export type WebDatabaseInputOpfs = {
  _tag: 'opfs'
  /** Filename of the database file (only used when exporting/downloading the database) */
  fileName: string
  opfsDirectory: string
  configureDb?: (db: SynchronousDatabase) => void
}

export type WebDatabaseInput = WebDatabaseInputInMemory | WebDatabaseInputOpfs

export const syncDbFactory =
  ({
    sqlite3,
  }: {
    sqlite3: SQLiteAPI
  }): MakeSynchronousDatabase<
    { dbPointer: number; persistenceInfo: PersistenceInfo },
    WebDatabaseInput,
    WebDatabaseMetadata
  > =>
  (input: WebDatabaseInput) =>
    Effect.gen(function* () {
      if (input._tag === 'in-memory') {
        const { dbPointer, vfs } = makeInMemoryDb(sqlite3)
        return makeSynchronousDatabase<WebDatabaseMetadataInMemory>({
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
        }) as any
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

      const { dbPointer, vfs } = yield* makeOpfsDb({
        sqlite3,
        directory: input.opfsDirectory,
        fileName: dbFilename,
      })

      return makeSynchronousDatabase<WebDatabaseMetadataOpfs>({
        sqlite3,
        metadata: {
          _tag: 'opfs',
          vfs,
          dbPointer,
          deleteDb: () => vfs.resetAccessHandle(input.fileName),
          configureDb: input.configureDb ?? (() => {}),
          persistenceInfo: {
            fileName: dbFilename,
            opfsDirectory: input.opfsDirectory,
            opfsFileName: vfs.getOpfsFileName(dbFilename),
          },
        },
      })
    })
