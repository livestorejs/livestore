import { type Coordinator, initializeSingletonTables, migrateDb } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { cuid } from '@livestore/utils/cuid'
import { Effect, Stream, SubscriptionRef, TRef } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeAdapterFactory } from '../make-adapter-factory.js'
import { makeInMemoryDb } from '../make-in-memory-db.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import { configureConnection } from '../web-worker/common.js'

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter = (initialData?: Uint8Array) =>
  makeAdapterFactory(({ schema, sqlite3 }) => Effect.succeed(makeCoordinator(schema, sqlite3, initialData)))

const makeCoordinator = (
  schema: LiveStoreSchema,
  sqlite3: SqliteWasm.Sqlite3Static,
  initialData?: Uint8Array,
): Coordinator => {
  const getInitialSnapshot = Effect.sync(() => {
    if (initialData !== undefined) {
      return initialData
    }

    const otelContext = otel.context.active()
    const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
    tmpDb.capi = sqlite3.capi

    configureConnection(tmpDb, { fkEnabled: true })
    const tmpMainDb = makeInMemoryDb(sqlite3, tmpDb)

    migrateDb({ db: tmpMainDb, otelContext, schema })

    initializeSingletonTables(schema, tmpMainDb)

    return tmpMainDb.export()
  })

  const hasLock = TRef.make(true).pipe(Effect.runSync)
  const syncMutations = Stream.never

  return {
    devtools: { channelId: cuid(), init: () => Effect.void, enabled: false },
    hasLock,
    syncMutations,
    execute: () => Effect.void,
    mutate: () => Effect.void,
    export: Effect.dieMessage('Not implemented'),
    getInitialSnapshot,
    getMutationLogData: Effect.succeed(new Uint8Array()),
    dangerouslyReset: () => Effect.void,
    shutdown: Effect.void,
    networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
  }
}
