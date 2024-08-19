import type { Coordinator, LockStatus, StoreAdapterFactory } from '@livestore/common'
import { initializeSingletonTables, migrateDb, UnexpectedError } from '@livestore/common'
import { Effect, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { WaSqlite } from '../sqlite/index.js'
import { makeSynchronousDatabase } from '../sqlite/make-sync-db.js'
import { configureConnection } from '../web-worker/common.js'

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = WaSqlite.loadSqlite3Wasm()

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter =
  (initialData?: Uint8Array): StoreAdapterFactory =>
  ({
    schema,
    // devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore
  }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      const db = WaSqlite.makeInMemoryDb(sqlite3)
      const syncDb = makeSynchronousDatabase(sqlite3, db)

      if (initialData === undefined) {
        yield* configureConnection({ syncDb }, { fkEnabled: true })

        yield* migrateDb({ db: syncDb, schema })

        initializeSingletonTables(schema, syncDb)
      } else {
        WaSqlite.importBytesToDb(sqlite3, db, initialData)

        yield* configureConnection({ syncDb }, { fkEnabled: true })
      }

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)
      const syncMutations = Stream.never

      const coordinator = {
        devtools: { appHostId: 'in-memory', enabled: false },
        lockStatus,
        syncMutations,
        execute: () => Effect.void,
        mutate: () => Effect.void,
        export: Effect.dieMessage('Not implemented'),
        getMutationLogData: Effect.succeed(new Uint8Array()),
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
      } satisfies Coordinator

      return { coordinator, syncDb }
    }).pipe(UnexpectedError.mapToUnexpectedError)
