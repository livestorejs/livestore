import type { Adapter, ClientSession, LockStatus } from '@livestore/common'
import { initializeSingletonTables, migrateDb, UnexpectedError } from '@livestore/common'
import { configureConnection } from '@livestore/common/leader-thread'
import { EventId } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { Effect, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

// TODO unify in-memory adapter with other in-memory adapter implementations

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = loadSqlite3Wasm()

/** NOTE: This adapter is currently only used for testing */
export const makeInMemoryAdapter =
  (initialData?: Uint8Array): Adapter =>
  ({
    schema,
    // devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore
  }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      const sqliteDb = yield* sqliteDbFactory({ sqlite3 })({ _tag: 'in-memory' })

      if (initialData === undefined) {
        yield* configureConnection(sqliteDb, { fkEnabled: true })

        yield* migrateDb({ db: sqliteDb, schema })

        initializeSingletonTables(schema, sqliteDb)
      } else {
        sqliteDb.import(initialData)

        yield* configureConnection(sqliteDb, { fkEnabled: true })
      }

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const clientSession = {
        sqliteDb,
        devtools: { enabled: false },
        clientId: 'in-memory',
        sessionId: nanoid(6),
        leaderThread: {
          mutations: {
            pull: Stream.never,
            push: () => Effect.void,
            initialMutationEventId: EventId.ROOT,
          },
          export: Effect.dieMessage('Not implemented'),
          getMutationLogData: Effect.succeed(new Uint8Array()),
          getSyncState: Effect.dieMessage('Not implemented'),
          networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
          sendDevtoolsMessage: () => Effect.dieMessage('Not implemented'),
        },
        lockStatus,
        shutdown: () => Effect.dieMessage('TODO implement shutdown'),
      } satisfies ClientSession

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError)
