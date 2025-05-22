import * as WaSqlite from '@livestore/wa-sqlite'
// @ts-expect-error TODO fix types in wa-sqlite
import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs'

export const loadSqlite3Wasm = async () => {
  const module = await WaSqliteFactory()
  // https://github.com/rhashimoto/wa-sqlite/issues/143#issuecomment-1899060056
  // module._free(module._malloc(10_000 * 4096 + 65_536))
  const sqlite3 = WaSqlite.Factory(module)
  // @ts-expect-error TODO fix types
  sqlite3.module = module
  return sqlite3
}
