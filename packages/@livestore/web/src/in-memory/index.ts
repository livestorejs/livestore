import type { Coordinator, LockStatus } from '@livestore/common'
import { initializeSingletonTables, migrateDb, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { Effect, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { makeAdapterFactory } from '../make-adapter-factory.js'
import { makeSynchronousDatabase } from '../make-in-memory-db.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import { configureConnection } from '../web-worker/common.js'

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter = (initialData?: Uint8Array) =>
  makeAdapterFactory(({ schema, sqlite3 }) => makeCoordinator(schema, sqlite3, initialData))

const makeCoordinator = (schema: LiveStoreSchema, sqlite3: SqliteWasm.Sqlite3Static, initialData?: Uint8Array) =>
  Effect.gen(function* () {
    const getInitialSnapshot = Effect.gen(function* () {
      if (initialData !== undefined) {
        return initialData
      }

      const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
      tmpDb.capi = sqlite3.capi

      yield* configureConnection(tmpDb, { fkEnabled: true }).pipe(UnexpectedError.mapToUnexpectedError)
      const tmpSyncDb = makeSynchronousDatabase(sqlite3, tmpDb)

      yield* migrateDb({ db: tmpSyncDb, schema })

      initializeSingletonTables(schema, tmpSyncDb)

      return tmpSyncDb.export()
    })

    const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)
    const syncMutations = Stream.never

    return {
      isShutdownRef: { current: false },
      devtools: { channelId: 'in-memory', enabled: false },
      lockStatus,
      syncMutations,
      execute: () => Effect.void,
      mutate: () => Effect.void,
      export: Effect.dieMessage('Not implemented'),
      getInitialSnapshot,
      getMutationLogData: Effect.succeed(new Uint8Array()),
      dangerouslyReset: () => Effect.void,
      networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
    } satisfies Coordinator
  })
