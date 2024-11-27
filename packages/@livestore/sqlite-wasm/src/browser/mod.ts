import type { MakeSynchronousDatabase } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'
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
  fileName: ':memory:'
}

export type WebDatabaseMetadataOpfs = {
  _tag: 'opfs'
  directory: string
  fileName: string
  vfs: AccessHandlePoolVFS
  dbPointer: number
}

export type WebDatabaseMetadata = WebDatabaseMetadataInMemory | WebDatabaseMetadataOpfs

export type WebDatabaseInputInMemory = {
  _tag: 'in-memory'
}

export type WebDatabaseInputOpfs = {
  _tag: 'opfs'
  directory: string
  fileName: string
}

export type WebDatabaseInput = WebDatabaseInputInMemory | WebDatabaseInputOpfs

export const syncDbFactory =
  ({
    sqlite3,
  }: {
    sqlite3: SQLiteAPI
  }): MakeSynchronousDatabase<{ dbPointer: number; fileName: string }, WebDatabaseInput, WebDatabaseMetadata> =>
  (input: WebDatabaseInput) =>
    Effect.gen(function* () {
      if (input._tag === 'in-memory') {
        const { dbPointer, vfs } = makeInMemoryDb(sqlite3)
        return makeSynchronousDatabase({
          sqlite3,
          metadata: { _tag: 'in-memory', vfs, dbPointer, fileName: ':memory:', deleteDb: () => {} },
        }) as any
      }

      const { dbPointer, vfs } = yield* makeOpfsDb({ sqlite3, directory: input.directory, fileName: input.fileName })
      return makeSynchronousDatabase({
        sqlite3,
        metadata: {
          _tag: 'opfs',
          directory: input.directory,
          fileName: input.fileName,
          vfs,
          dbPointer,
          deleteDb: () => vfs.resetAccessHandle(input.fileName),
        },
      })
    })
