import { type Coordinator, initializeSingletonTables, migrateDb } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import sqlite3InitModule from '@livestore/sqlite-wasm'
import { cuid } from '@livestore/utils/cuid'
import { Effect, Stream, SubscriptionRef, TRef } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeAdapterFactory } from '../make-adapter-factory.js'
import { makeInMemoryDb } from '../make-in-memory-db.js'
import { importBytesToDb } from '../sqlite-utils.js'
import { configureConnection } from '../web-worker/common.js'

const sqlite3Promise = sqlite3InitModule({
  print: (message) => console.log(`[sql-client] ${message}`),
  printErr: (message) => console.error(`[sql-client] ${message}`),
})

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter = (initialData?: Uint8Array) =>
  makeAdapterFactory(({ schema }) => Effect.succeed(makeCoordinator(schema, initialData)))

const makeCoordinator = (schema: LiveStoreSchema, initialData?: Uint8Array): Coordinator => {
  const getInitialSnapshot = () =>
    Effect.gen(function* ($) {
      const sqlite3 = yield* $(Effect.tryPromise(() => sqlite3Promise))

      const otelContext = otel.context.active()
      const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
      tmpDb.capi = sqlite3.capi

      if (initialData !== undefined) {
        importBytesToDb(sqlite3, tmpDb, initialData)
      }

      configureConnection(tmpDb, { fkEnabled: true })
      const tmpMainDb = makeInMemoryDb(sqlite3, tmpDb)

      migrateDb({ db: tmpMainDb, otelContext, schema })

      initializeSingletonTables(schema, tmpMainDb)

      return tmpMainDb.export()
    }).pipe(Effect.runPromise)

  const dangerouslyReset = async () => {}
  const shutdown = async () => {}

  const hasLock = TRef.make(true).pipe(Effect.runSync)
  const syncMutations = Stream.never

  return {
    devtools: { channelId: cuid() },
    hasLock,
    syncMutations,
    execute: async () => {},
    mutate: async () => {},
    export: async () => undefined,
    getInitialSnapshot,
    getMutationLogData: async () => new Uint8Array(),
    dangerouslyReset,
    shutdown,
    networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
  }
}
