import type { Adapter, Coordinator, LockStatus } from '@livestore/common'
import { initializeSingletonTables, migrateDb, UnexpectedError } from '@livestore/common'
import { configureConnection } from '@livestore/common/leader-thread'
import { EventId } from '@livestore/common/schema'
import { syncDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { Effect, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

// TODO unify in-memory adapter with other in-memory adapter implementations

/** NOTE: This coordinator is currently only used for testing */
export const makeInMemoryAdapter =
  (initialData?: Uint8Array): Adapter =>
  ({
    schema,
    // devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore
  }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

      const syncDb = yield* syncDbFactory({ sqlite3 })({ _tag: 'in-memory' })

      if (initialData === undefined) {
        yield* configureConnection(syncDb, { fkEnabled: true })

        yield* migrateDb({ db: syncDb, schema })

        initializeSingletonTables(schema, syncDb)
      } else {
        syncDb.import(initialData)

        yield* configureConnection(syncDb, { fkEnabled: true })
      }

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const coordinator = {
        devtools: { appHostId: 'in-memory', enabled: false },
        sessionId: `in-memory-${nanoid(6)}`,
        lockStatus,
        mutations: {
          pull: Stream.never,
          push: () => Effect.void,
          initialMutationEventId: EventId.ROOT,
        },
        export: Effect.dieMessage('Not implemented'),
        getMutationLogData: Effect.succeed(new Uint8Array()),
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
        shutdown: () => Effect.dieMessage('TODO implement shutdown'),
        getLeaderSyncState: Effect.dieMessage('Not implemented'),
      } satisfies Coordinator

      return { coordinator, syncDb }
    }).pipe(UnexpectedError.mapToUnexpectedError)
