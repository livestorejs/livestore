import type * as SqliteWasm from '@livestore/sqlite-wasm'

export const importBytesToDb = (sqlite3: SqliteWasm.Sqlite3Static, db: SqliteWasm.Database, bytes: Uint8Array) => {
  // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
  // TODO find cleaner way to do this once possible in sqlite3-wasm
  const p = sqlite3.wasm.allocFromTypedArray(bytes)
  const _rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer!,
    'main',
    p,
    bytes.length,
    bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  )
}
