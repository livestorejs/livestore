export { importBytesToDb } from './utils/sqlite-utils.js'

export * from './make-in-memory-db.js'

import initSqlite3Wasm from '@livestore/sqlite-wasm'

export const loadSqlite3Wasm = () =>
  initSqlite3Wasm({
    print: (message) => console.log(`[livestore sqlite] ${message}`),
    printErr: (message) => console.error(`[livestore sqlite] ${message}`),
  })

export type * as SqliteWasm from '@livestore/sqlite-wasm'
