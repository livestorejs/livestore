import * as WaSqlite from '@livestore/wa-sqlite'
import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.mjs'

// @ts-expect-error TODO fix types in wa-sqlite
import wasm from '@livestore/wa-sqlite/dist/wa-sqlite.wasm'

// Note that it's important that the `workerd` entry is the first one in the `exports` map in the `package.json` file.
export const loadSqlite3Wasm = async () => {
  // It seems we need to pass in the wasm binary directly for workerd to work
  // This is due to workerd not supporting the same patterns as Vite for automatically loading WASM.
  const module = await WaSqliteFactory({
    instantiateWasm: (info: any, receiveInstance: any) => {
      try {
        // Use the pre-compiled module directly
        const instance = new WebAssembly.Instance(wasm, info)
        receiveInstance(instance, wasm)
        return instance.exports
      } catch (error) {
        console.error('Failed to instantiate WASM:', error)
        throw error
      }
    },
  })
  const sqlite3 = WaSqlite.Factory(module)
  // @ts-expect-error TODO fix types
  sqlite3.module = module
  return sqlite3
}
