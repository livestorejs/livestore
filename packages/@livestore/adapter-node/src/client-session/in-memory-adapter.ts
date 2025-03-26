import type {
  Adapter,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  MakeSqliteDb,
  SyncOptions,
} from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { getClientHeadFromDb, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
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
    overrides?: {
      leaderThread?: Partial<ClientSessionLeaderThreadProxy>
    }
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
    overrides?: {
      leaderThread?: Partial<ClientSessionLeaderThreadProxy>
    }
  }
}) =>
  Effect.gen(function* () {
    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        dbReadModel: yield* makeSqliteDb({ _tag: 'in-memory' }),
        dbMutationLog: yield* makeSqliteDb({ _tag: 'in-memory' }),
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
      const {
        dbReadModel: db,
        dbMutationLog,
        syncProcessor,
        connectedClientSessionPullQueues,
        extraIncomingMessagesQueue,
        initialState,
      } = yield* LeaderThreadCtx

      const initialLeaderHead = getClientHeadFromDb(dbMutationLog)
      const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(initialLeaderHead)

      const leaderThread = {
        mutations: {
          pull: testing?.overrides?.leaderThread?.mutations?.pull ?? (() => Stream.fromQueue(pullQueue)),
          push: (batch) =>
            syncProcessor
              .push(
                batch.map((item) => new MutationEvent.EncodedWithMeta(item)),
                { waitForProcessing: true },
              )
              .pipe(Effect.provide(layer), Effect.scoped),
        },
        initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
        export: Effect.sync(() => db.export()),
        getMutationLogData: Effect.sync(() => dbMutationLog.export()),
        // TODO
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now(), latchClosed: false }).pipe(
          Effect.runSync,
        ),
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

      const initialSnapshot = db.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })
