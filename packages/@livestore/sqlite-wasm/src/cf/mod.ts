// import path from 'node:path'

import { type MakeSqliteDb, type PersistenceInfo, type SqliteDb, UnexpectedError } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'
import type * as WaSqlite from '@livestore/wa-sqlite'
import type { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'
import { makeInMemoryDb } from '../in-memory-vfs.ts'
import { makeSqliteDb } from '../make-sqlite-db.ts'
import { CloudflareSqlVFS } from './CloudflareSqlVFS.ts'
import type * as Cf from './cf-types.ts'

export { BlockManager } from './BlockManager.ts'
export { CloudflareSqlVFS } from './CloudflareSqlVFS.ts'
export { CloudflareWorkerVFS } from './CloudflareWorkerVFS.ts'
export type * as Cf from './cf-types.ts'

export type CloudflareDatabaseMetadataInMemory = {
  _tag: 'in-memory'
  vfs: MemoryVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo
  deleteDb: () => void
  configureDb: (db: SqliteDb) => void
}

export type CloudflareDatabaseMetadataFs = {
  _tag: 'storage'
  // vfs: CloudflareWorkerVFS
  vfs: CloudflareSqlVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo
  deleteDb: () => void
  configureDb: (db: SqliteDb) => void
}

export type CloudflareDatabaseMetadata = CloudflareDatabaseMetadataInMemory | CloudflareDatabaseMetadataFs

export type CloudflareDatabaseInputInMemory = {
  _tag: 'in-memory'
  configureDb?: (db: SqliteDb) => void
}

export type CloudflareDatabaseInputFs = {
  _tag: 'storage'
  // directory: string
  fileName: string
  configureDb?: (db: SqliteDb) => void
  storage: Cf.DurableObjectStorage
}

export type CloudflareDatabaseInput = CloudflareDatabaseInputInMemory | CloudflareDatabaseInputFs

export type MakeCloudflareSqliteDb = MakeSqliteDb<
  { dbPointer: number; persistenceInfo: PersistenceInfo },
  CloudflareDatabaseInput,
  CloudflareDatabaseMetadata
>

export const sqliteDbFactory =
  ({ sqlite3 }: { sqlite3: SQLiteAPI }): MakeCloudflareSqliteDb =>
  (input) =>
    Effect.gen(function* () {
      if (input._tag === 'in-memory') {
        const { dbPointer, vfs } = makeInMemoryDb(sqlite3)
        return makeSqliteDb<CloudflareDatabaseMetadataInMemory>({
          sqlite3,
          metadata: {
            _tag: 'in-memory',
            vfs,
            dbPointer,
            persistenceInfo: { fileName: ':memory:' },
            deleteDb: () => {},
            configureDb: input.configureDb ?? (() => {}),
          },
        }) as any
      }

      const { dbPointer, vfs } = yield* makeCloudflareFsDb({
        sqlite3,
        fileName: input.fileName,
        // directory: input.directory,
        storage: input.storage,
      })

      // const filePath = path.join(input.directory, input.fileName)
      // const filePath = `${input.directory}/${input.fileName}`

      return makeSqliteDb<CloudflareDatabaseMetadataFs>({
        sqlite3,
        metadata: {
          _tag: 'storage',
          vfs,
          dbPointer,
          persistenceInfo: { fileName: input.fileName },
          // deleteDb: () => vfs.deleteDb(filePath),
          // TODO: implement deleteDb
          deleteDb: () => {},
          configureDb: input.configureDb ?? (() => {}),
        },
      })
    })


const makeCloudflareFsDb = ({
  sqlite3,
  fileName,
  // directory,
  storage,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  fileName: string
  // directory: string
  storage: Cf.DurableObjectStorage
}) =>
  Effect.gen(function* () {
    // NOTE to keep the filePath short, we use the directory name in the vfs name
    // If this is becoming a problem, we can use a hashed version of the directory name
    const vfsName = `cf-do-sqlite-${fileName}`
    if (sqlite3.vfs_registered.has(vfsName) === false) {
      // TODO refactor with Effect FileSystem instead of using `node:fs` directly inside of CloudflareWorkerVFS
      // const nodeFsVfs = new CloudflareWorkerVFS(vfsName, storage, (sqlite3 as any).module)
      const nodeFsVfs = new CloudflareSqlVFS(vfsName, storage.sql, (sqlite3 as any).module)

      // Initialize the VFS schema before registering it
      const isReady = yield* Effect.promise(() => nodeFsVfs.isReady())
      if (!isReady) {
        throw new Error(`Failed to initialize CloudflareSqlVFS for ${vfsName}`)
      }

      // @ts-expect-error TODO fix types
      sqlite3.vfs_register(nodeFsVfs, false)
    }

    // yield* fs.makeDirectory(directory, { recursive: true })

    const FILE_NAME_MAX_LENGTH = 56
    if (fileName.length > FILE_NAME_MAX_LENGTH) {
      throw new Error(`File name ${fileName} is too long. Maximum length is ${FILE_NAME_MAX_LENGTH} characters.`)
    }

    // NOTE SQLite will return a "disk I/O error" if the file path is too long.
    const dbPointer = sqlite3.open_v2Sync(fileName, undefined, vfsName)

    return { dbPointer, vfs: {} as UNUSED<'only needed in web adapter currently and should longer-term be removed'> }
  }).pipe(UnexpectedError.mapToUnexpectedError)
