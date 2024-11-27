import * as WaSqlite from '@livestore/wa-sqlite'
// @ts-expect-error TODO fix types
// import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.node.wasm'
import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs'
import { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'

import { NodeFS } from './wa-sqlite/NodeFS.js'

// import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.mjs'
// import WaSqliteFactory from '../../wa-sqlite.wasm' with { type: 'wasm' }

export * as SqliteConstants from '@livestore/wa-sqlite/src/sqlite-constants.js'
export { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'
// export { AccessHandlePoolVFS } from '@livestore/wa-sqlite/src/examples/AccessHandlePoolVFS.js'
// export { AccessHandlePoolVFS } from './wa-sqlite/AccessHandlePoolVFS.js'

export const loadSqlite3Wasm = async () => {
  // const fileUrl = new URL(WaSqliteFactory, import.meta.url)
  // const buffer = await fetch(fileUrl).then((res) => res.arrayBuffer())
  // const module = await WebAssembly.compile(buffer)
  // console.log('module', module)

  const module = await WaSqliteFactory()
  // console.log('module', module, typeof module)
  // // https://github.com/rhashimoto/wa-sqlite/issues/143#issuecomment-1899060056
  // module._free(module._malloc(10_000 * 4096 + 65_536))
  const sqlite3 = WaSqlite.Factory(module)
  // @ts-expect-error TODO fix types
  sqlite3.module = module
  return sqlite3
}

export const importBytesToDb = (
  sqlite3: WaSqlite.SQLiteAPI,
  db: number,
  bytes: Uint8Array,
  readOnly: boolean = false,
) => {
  // https://www.sqlite.org/c3ref/c_deserialize_freeonclose.html
  // #define SQLITE_DESERIALIZE_FREEONCLOSE 1 /* Call sqlite3_free() on close */
  // #define SQLITE_DESERIALIZE_RESIZEABLE  2 /* Resize using sqlite3_realloc64() */
  // #define SQLITE_DESERIALIZE_READONLY    4 /* Database is read-only */
  const FREE_ON_CLOSE = 1
  const RESIZEABLE = 2

  if (readOnly === true) {
    sqlite3.deserialize(db, 'main', bytes, bytes.length, bytes.length, FREE_ON_CLOSE | RESIZEABLE)
  } else {
    const tmpDb = makeInMemoryDb(sqlite3)
    // TODO find a way to do this more efficiently with sqlite to avoid either of the deserialize + backup call
    // Maybe this can be done via the VFS API
    sqlite3.deserialize(tmpDb, 'main', bytes, bytes.length, bytes.length, FREE_ON_CLOSE | RESIZEABLE)
    sqlite3.backup(db, 'main', tmpDb, 'main')
    sqlite3.close(tmpDb)
  }
}

export const makeInMemoryDb = (sqlite3: WaSqlite.SQLiteAPI) => {
  if (sqlite3.vfs_registered.has('memory-vfs') === false) {
    // @ts-expect-error TODO fix types
    const vfs = new MemoryVFS('memory-vfs', (sqlite3 as any).module)

    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
  }

  const db = sqlite3.open_v2Sync(':memory:', undefined, 'memory-vfs')

  return db
}

export const makeNodeFsDb = (sqlite3: WaSqlite.SQLiteAPI, filePath: string) => {
  const vfs = new NodeFS('node-fs', (sqlite3 as any).module)
  if (sqlite3.vfs_registered.has('node-fs') === false) {
    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
  }
  return sqlite3.open_v2Sync(filePath, undefined, 'node-fs')
}

export const exportDb = (sqlite3: WaSqlite.SQLiteAPI, db: number) => {
  return sqlite3.serialize(db, 'main')
}
