import type * as WaSqlite from '@livestore/wa-sqlite'
import { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'

let cachedMemoryVfs: MemoryVFS | undefined

export const makeInMemoryDb = (sqlite3: WaSqlite.SQLiteAPI) => {
  if (sqlite3.vfs_registered.has('memory-vfs') === false) {
    // @ts-expect-error TODO fix types
    const vfs = new MemoryVFS('memory-vfs', (sqlite3 as any).module)

    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
    cachedMemoryVfs = vfs
  }

  const dbPointer = sqlite3.open_v2Sync(':memory:', undefined, 'memory-vfs')
  const vfs = cachedMemoryVfs!

  return { dbPointer, vfs }
}
