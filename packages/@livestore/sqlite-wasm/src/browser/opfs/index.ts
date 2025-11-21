import { Effect, type Opfs, type Scope } from '@livestore/utils/effect'
import type * as WaSqlite from '@livestore/wa-sqlite'

import { AccessHandlePoolVFS } from './AccessHandlePoolVFS.ts'

const semaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)
const opfsVfsMap = new Map<string, AccessHandlePoolVFS>()

export const makeOpfsDb = ({
  sqlite3,
  directory,
  fileName,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  directory: string
  fileName: string
}): Effect.Effect<{ dbPointer: number; vfs: AccessHandlePoolVFS }, never, Opfs.Opfs | Scope.Scope> =>
  Effect.gen(function* () {
    // Replace all special characters with underscores
    const safePath = directory.replaceAll(/["*/:<>?\\|]/g, '_')
    const pathSegment = safePath.length === 0 ? '' : `-${safePath}`
    const vfsName = `opfs${pathSegment}`

    if (sqlite3.vfs_registered.has(vfsName) === false) {
      const vfs = yield* AccessHandlePoolVFS.create(vfsName, directory, (sqlite3 as any).module)

      sqlite3.vfs_register(vfs, false)
      opfsVfsMap.set(vfsName, vfs)
    }

    const dbPointer = sqlite3.open_v2Sync(fileName, undefined, vfsName)
    const vfs = opfsVfsMap.get(vfsName)!

    return { dbPointer, vfs }
  }).pipe(semaphore.withPermits(1))
