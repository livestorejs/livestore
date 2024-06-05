import { type StoreAdapter, type StoreAdapterFactory } from '@livestore/common'
import type * as Sqlite from '@livestore/sqlite-wasm'
import initSqlite3Wasm from '@livestore/sqlite-wasm'
import { makeNoopSpan, shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeInMemoryDb } from './make-in-memory-db.js'
import { importBytesToDb } from './utils/sqlite-utils.js'
import type { MakeCoordinator } from './utils/types.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

export const makeAdapterFactory =
  (makeCoordinator: MakeCoordinator): StoreAdapterFactory =>
  async ({ otelTracer, otelContext, schema }) => {
    const sqlite3 = await sqlite3Promise

    const coordinator = await otelTracer.startActiveSpan('coordinator:load', {}, otelContext, async (span) => {
      try {
        const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
        return makeCoordinator({ otel: { otelTracer, parentSpan }, schema }).pipe(
          Effect.tapCauseLogPretty,
          Effect.runPromise,
        )
      } catch (e) {
        console.error(e)
        return shouldNeverHappen()
      } finally {
        span.end()
      }
    })

    const persistedData = await otelTracer.startActiveSpan(
      'coordinator:getPersistedData',
      {},
      otelContext,
      async (span) => {
        try {
          return await coordinator.getInitialSnapshot()
        } catch (e) {
          console.error(e)
          return shouldNeverHappen()
        } finally {
          span.end()
        }
      },
    )

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
    db.capi = sqlite3.capi

    importBytesToDb(sqlite3, db, persistedData)

    return { mainDb: makeInMemoryDb(sqlite3, db), coordinator } satisfies StoreAdapter
  }
