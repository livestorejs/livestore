import { type DatabaseFactory, type DatabaseImpl } from '@livestore/common'
import type * as Sqlite from '@livestore/sqlite-wasm'
import initSqlite3Wasm from '@livestore/sqlite-wasm'
import { makeNoopSpan } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import { makeMainDb } from './make-main-db.js'
import { rehydrateFromMutationLog } from './rehydrate-from-mutationlog.js'
import { InMemoryStorage } from './storage/in-memory/index.js'
import type { StorageInit } from './storage/index.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

export const makeDb =
  (loadStorage?: () => StorageInit | Promise<StorageInit>): DatabaseFactory =>
  async ({ otelTracer, otelContext, migrationStrategy, schema }) => {
    const sqlite3 = await sqlite3Promise

    const storageDb = await otelTracer.startActiveSpan('storage:load', {}, otelContext, async (span) => {
      try {
        const init = loadStorage ? await loadStorage() : InMemoryStorage.load()
        const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
        return init({ otel: { otelTracer, parentSpan }, data: undefined })
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
          const data = await storageDb.export(span)
          // NOTE we're always returning a Uint8Array here, to make sure th `sqlite3` object is always
          // re-initialized with an empty database (e.g. during tests)

          if (data === undefined && migrationStrategy._tag === 'from-mutation-log') {
            return rehydrateFromMutationLog({
              sqlite3,
              storageDbRef: { current: storageDb },
              otelTracer,
              otelContext,
              schema,
              loadStorage,
            })
          }

          return data ?? new Uint8Array()
        } finally {
          span.end()
        }
      },
    )

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
    db.capi = sqlite3.capi

    // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
    // TODO find cleaner way to do this once possible in sqlite3-wasm
    const bytes = persistedData
    const p = sqlite3.wasm.allocFromTypedArray(bytes)
    const _rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      p,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    )

    return { mainDb: makeMainDb(sqlite3, db), storageDb } satisfies DatabaseImpl
  }
