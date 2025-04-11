import type {
  Adapter,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  MakeSqliteDb,
  SqliteDb,
  SyncOptions,
} from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import type { Schema } from '@livestore/utils/effect'
import { Cause, Effect, FetchHttpClient, Layer, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { makeShutdownChannel } from '../shutdown-channel.js'

// TODO unify in-memory adapter with other in-memory adapter implementations

export interface InMemoryAdapterOptions {
  sync?: SyncOptions
  /**
   * @default 'in-memory'
   */
  clientId?: string
  /**
   * @default nanoid(6)
   */
  sessionId?: string

  /** Only used internally for testing */
  testing?: {
    overrides?: TestingOverrides
  }
}

export type TestingOverrides = {
  clientSession?: {
    leaderThreadProxy?: Partial<ClientSessionLeaderThreadProxy>
  }
  makeLeaderThread?: {
    dbEventlog?: (makeSqliteDb: MakeSqliteDb) => Effect.Effect<SqliteDb, UnexpectedError>
  }
}

/** NOTE: This adapter is currently only used for testing */
export const makeInMemoryAdapter =
  ({ sync: syncOptions, clientId = 'in-memory', sessionId = nanoid(6), testing }: InMemoryAdapterOptions): Adapter =>
  ({
    schema,
    storeId,
    shutdown,
    syncPayload,
    // devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore
  }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((error) => Effect.sync(() => shutdown(Cause.fail(error)))),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        storeId,
        clientId,
        schema,
        makeSqliteDb,
        syncOptions,
        syncPayload,
        testing,
      })

      sqliteDb.import(initialSnapshot)

      const clientSession = {
        sqliteDb,
        devtools: { enabled: false },
        clientId,
        sessionId,
        lockStatus,
        leaderThread,
        shutdown,
      } satisfies ClientSession

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError)

const makeLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  syncPayload,
  testing,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  syncPayload: Schema.JsonValue | undefined
  testing?: {
    overrides?: TestingOverrides
  }
}) =>
  Effect.gen(function* () {
    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        dbReadModel: yield* makeSqliteDb({ _tag: 'in-memory' }),
        dbEventlog: testing?.overrides?.makeLeaderThread?.dbEventlog
          ? yield* testing.overrides.makeLeaderThread.dbEventlog(makeSqliteDb)
          : yield* makeSqliteDb({ _tag: 'in-memory' }),
        devtoolsOptions: { enabled: false },
        makeSqliteDb,
        schema,
        // NOTE we're creating a separate channel here since you can't listen to your own channel messages
        shutdownChannel: yield* makeShutdownChannel(storeId),
        storeId,
        syncOptions,
        syncPayload,
      }).pipe(Layer.provideMerge(FetchHttpClient.layer)),
    )

    return yield* Effect.gen(function* () {
      const { dbReadModel, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = {
        mutations: {
          pull:
            testing?.overrides?.clientSession?.leaderThreadProxy?.mutations?.pull ??
            (({ cursor }) => syncProcessor.pull({ cursor })),
          push: (batch) =>
            syncProcessor.push(
              batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
              { waitForProcessing: true },
            ),
        },
        initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
        export: Effect.sync(() => dbReadModel.export()),
        getEventlogData: Effect.sync(() => dbEventlog.export()),
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

      const initialSnapshot = dbReadModel.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })
