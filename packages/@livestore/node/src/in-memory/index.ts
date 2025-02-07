import type {
  Adapter,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  MakeSqliteDb,
  SyncOptions,
} from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { getLocalHeadFromDb, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { Effect, FetchHttpClient, Layer, Stream, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

// TODO unify in-memory adapter with other in-memory adapter implementations

export interface InMemoryAdapterOptions {
  sync?: SyncOptions
  /**
   * @default 'in-memory'
   */
  clientId?: string
}

/** NOTE: This adapter is currently only used for testing */
export const makeInMemoryAdapter =
  ({ sync: syncOptions, clientId = 'in-memory' }: InMemoryAdapterOptions): Adapter =>
  ({
    schema,
    storeId,
    // devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore
  }) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const sessionId = nanoid(6)

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        storeId,
        clientId,
        schema,
        makeSqliteDb,
        syncOptions,
      })

      sqliteDb.import(initialSnapshot)

      const clientSession = {
        sqliteDb,
        devtools: { enabled: false },
        clientId,
        sessionId,
        lockStatus,
        leaderThread,
        shutdown: () => Effect.dieMessage('TODO implement shutdown'),
      } satisfies ClientSession

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError)

const makeLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
}) =>
  Effect.gen(function* () {
    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        db: yield* makeSqliteDb({ _tag: 'in-memory' }),
        dbLog: yield* makeSqliteDb({ _tag: 'in-memory' }),
        devtoolsOptions: { enabled: false },
        makeSqliteDb,
        schema,
        shutdownChannel: yield* WebChannel.noopChannel<any, any>(),
        storeId,
        syncOptions,
      }).pipe(Layer.provideMerge(FetchHttpClient.layer)),
    )

    return yield* Effect.gen(function* () {
      const { db, dbLog, syncProcessor, connectedClientSessionPullQueues, extraIncomingMessagesQueue } =
        yield* LeaderThreadCtx

      const initialMutationEventId = getLocalHeadFromDb(dbLog)
      const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(initialMutationEventId)

      const leaderThread = {
        mutations: {
          pull: Stream.fromQueue(pullQueue),
          push: (batch) =>
            syncProcessor
              .push(batch.map((item) => new MutationEvent.EncodedWithMeta(item)))
              .pipe(Effect.provide(layer), Effect.scoped),
          initialMutationEventId,
        },
        export: Effect.sync(() => db.export()),
        getMutationLogData: Effect.sync(() => dbLog.export()),
        // TODO
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

      const initialSnapshot = db.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })
