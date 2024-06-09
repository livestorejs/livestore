import { type Coordinator, initializeSingletonTables, migrateDb, type PreparedBindValues } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import sqlite3InitModule from '@livestore/sqlite-wasm'
import { Effect, Stream, SubscriptionRef, TRef } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeAdapterFactory } from '../make-adapter-factory.js'
import { makeInMemoryDb } from '../make-in-memory-db.js'
import { configureConnection } from '../web-worker/common.js'

const sqlite3Promise = sqlite3InitModule({
  print: (message) => console.log(`[sql-client] ${message}`),
  printErr: (message) => console.error(`[sql-client] ${message}`),
})

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter = () => makeAdapterFactory(({ schema }) => Effect.succeed(makeCoordinator(schema)))

const makeCoordinator = (schema: LiveStoreSchema): Coordinator => {
  const execute = async (_query: string, _bindValues?: PreparedBindValues) => {}

  const mutate = async (_mutationEventEncoded: MutationEvent.Any, _parentSpan?: otel.Span | undefined) => {}

  const exportData = async () => undefined

  const getInitialSnapshot = () =>
    Effect.gen(function* ($) {
      const sqlite3 = yield* $(Effect.tryPromise(() => sqlite3Promise))

      const otelContext = otel.context.active()
      const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
      tmpDb.capi = sqlite3.capi
      configureConnection(tmpDb, { fkEnabled: true })
      const tmpMainDb = makeInMemoryDb(sqlite3, tmpDb)

      migrateDb({ db: tmpMainDb, otelContext, schema })

      initializeSingletonTables(schema, tmpMainDb)

      return tmpMainDb.export()
    }).pipe(Effect.runPromise)

  const getMutationLogData = async () => new Uint8Array()

  const dangerouslyReset = async () => {}
  const shutdown = async () => {}

  const hasLock = TRef.make(true).pipe(Effect.runSync)
  const syncMutations = Stream.never

  return {
    hasLock,
    syncMutations,
    execute,
    mutate,
    export: exportData,
    getInitialSnapshot,
    getMutationLogData,
    dangerouslyReset,
    shutdown,
    networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
  }
}
