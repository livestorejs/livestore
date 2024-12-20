import fs from 'node:fs'
import path from 'node:path'

import type { MakeSynchronousDatabase, PersistenceInfo, SynchronousDatabase } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'
import type * as WaSqlite from '@livestore/wa-sqlite'
import type { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'

import { makeInMemoryDb } from '../in-memory-vfs.js'
import { makeSynchronousDatabase } from '../make-sync-db.js'
import { NodeFS } from './NodeFS.js'

export type NodeDatabaseMetadataInMemory = {
  _tag: 'in-memory'
  vfs: MemoryVFS
  dbPointer: number
  persistenceInfo: PersistenceInfo
  deleteDb: () => void
  configureDb: (db: SynchronousDatabase) => void
}

export type NodeDatabaseMetadataFs = {
  _tag: 'fs'
  vfs: NodeFS
  dbPointer: number
  persistenceInfo: PersistenceInfo<{ directory: string }>
  deleteDb: () => void
  configureDb: (db: SynchronousDatabase) => void
}

export type NodeDatabaseMetadata = NodeDatabaseMetadataInMemory | NodeDatabaseMetadataFs

export type NodeDatabaseInputInMemory = {
  _tag: 'in-memory'
  configureDb?: (db: SynchronousDatabase) => void
}

export type NodeDatabaseInputFs = {
  _tag: 'fs'
  directory: string
  fileName: string
  configureDb?: (db: SynchronousDatabase) => void
}

export type NodeDatabaseInput = NodeDatabaseInputInMemory | NodeDatabaseInputFs

// TODO refactor with Effect FileSystem instead of using `node:fs` directly
export const syncDbFactory =
  ({
    sqlite3,
  }: {
    sqlite3: SQLiteAPI
  }): MakeSynchronousDatabase<
    { dbPointer: number; persistenceInfo: PersistenceInfo },
    NodeDatabaseInput,
    NodeDatabaseMetadata
  > =>
  (input) =>
    Effect.gen(function* () {
      if (input._tag === 'in-memory') {
        const { dbPointer, vfs } = makeInMemoryDb(sqlite3)
        return makeSynchronousDatabase<NodeDatabaseMetadataInMemory>({
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

      const { dbPointer, vfs } = makeNodeFsDb({ sqlite3, fileName: input.fileName, directory: input.directory })

      const filePath = path.join(input.directory, input.fileName)

      return makeSynchronousDatabase<NodeDatabaseMetadataFs>({
        sqlite3,
        metadata: {
          _tag: 'fs',
          vfs,
          dbPointer,
          persistenceInfo: { fileName: input.fileName, directory: input.directory },
          deleteDb: () => vfs.deleteDb(filePath),
          configureDb: input.configureDb ?? (() => {}),
        },
      })
    })

let nodeFsVfs: NodeFS | undefined

const makeNodeFsDb = ({
  sqlite3,
  fileName,
  directory,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  fileName: string
  directory: string
}) => {
  // NOTE to keep the filePath short, we use the directory name in the vfs name
  // If this is becoming a problem, we can use a hashed version of the directory name
  const vfsName = `node-fs-${directory}`
  if (nodeFsVfs === undefined) {
    nodeFsVfs = new NodeFS(vfsName, (sqlite3 as any).module, directory)
    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(nodeFsVfs, false)
  }

  fs.mkdirSync(directory, { recursive: true })

  const FILE_NAME_MAX_LENGTH = 56
  if (fileName.length > FILE_NAME_MAX_LENGTH) {
    throw new Error(`File name ${fileName} is too long. Maximum length is ${FILE_NAME_MAX_LENGTH} characters.`)
  }

  // NOTE SQLite will return a "disk I/O error" if the file path is too long.
  const dbPointer = sqlite3.open_v2Sync(fileName, undefined, vfsName)

  return { dbPointer, vfs: nodeFsVfs }
}
