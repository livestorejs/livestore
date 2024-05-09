import { type DatabaseFactory, type DatabaseImpl } from '@livestore/common'
import type * as Sqlite from '@livestore/sqlite-wasm'
import initSqlite3Wasm from '@livestore/sqlite-wasm'
import { makeNoopSpan } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import { makeInMemoryDb } from './make-in-memory-db.js'
import { InMemoryStorage } from './storage/in-memory/index.js'
import { importBytesToDb } from './storage/utils/sqlite-utils.js'
import type { StorageInit } from './storage/utils/types.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

export const makeDb =
  (loadStorage?: () => StorageInit | Promise<StorageInit>): DatabaseFactory =>
  async ({ otelTracer, otelContext, schema }) => {
    const sqlite3 = await sqlite3Promise

    const storageDb = await otelTracer.startActiveSpan('storage:load', {}, otelContext, async (span) => {
      try {
        const init = loadStorage ? await loadStorage() : InMemoryStorage.load()
        const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
        return init({ otel: { otelTracer, parentSpan }, schema })
      } finally {
        span.end()
      }
    })

    const persistedData = await otelTracer.startActiveSpan(
      'storage:getPersistedData',
      {},
      otelContext,
      async (span) => {
        try {
          return await storageDb.getInitialSnapshot()
        } finally {
          span.end()
        }
      },
    )

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
    db.capi = sqlite3.capi

    importBytesToDb(sqlite3, db, persistedData)

    return { mainDb: makeInMemoryDb(sqlite3, db), storageDb } satisfies DatabaseImpl
  }
