import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  type LockStatus,
  liveStoreStorageFormatVersion,
  makeClientSession,
  type SyncOptions,
  UnexpectedError,
} from '@livestore/common'
import { type DevtoolsOptions, Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { LiveStoreEvent } from '@livestore/livestore'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/cf'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { Effect, FetchHttpClient, Layer, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'

export const makeAdapter =
  ({
    storage,
    clientId,
    syncOptions,
    sessionId,
  }: {
    storage: CfWorker.DurableObjectStorage
    clientId: string
    syncOptions: SyncOptions
    sessionId: string
  }): Adapter =>
  (adapterArgs) =>
    Effect.gen(function* () {
      const { storeId, devtoolsEnabled, shutdown, bootStatusQueue, syncPayload, schema } = adapterArgs

      const devtoolsOptions = { enabled: false } as DevtoolsOptions

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })

      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory', storage, configureDb: () => {} }).pipe(
        UnexpectedError.mapToUnexpectedError,
      )

      const schemaHashSuffix =
        schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()

      const dbState = yield* makeSqliteDb({
        _tag: 'storage',
        storage,
        fileName: getStateDbFileName(schemaHashSuffix),
        configureDb: () => {},
      }).pipe(UnexpectedError.mapToUnexpectedError)

      const dbEventlog = yield* makeSqliteDb({
        _tag: 'storage',
        storage,
        fileName: `eventlog@${liveStoreStorageFormatVersion}.db`,
        configureDb: () => {},
      }).pipe(UnexpectedError.mapToUnexpectedError)

      const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

      // Use Durable Object sync backend if no backend is specified

      const layer = yield* Layer.build(
        makeLeaderThreadLayer({
          schema,
          storeId,
          clientId,
          makeSqliteDb,
          syncOptions,
          dbState,
          dbEventlog,
          devtoolsOptions,
          shutdownChannel,
          syncPayload,
        }),
      )

      const { leaderThread, initialSnapshot } = yield* Effect.gen(function* () {
        const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState } = yield* LeaderThreadCtx

        const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)
        // const initialLeaderHead = EventSequenceNumber.ROOT

        const leaderThread = ClientSessionLeaderThreadProxy.of(
          {
            events: {
              pull: ({ cursor }) => syncProcessor.pull({ cursor }),
              push: (batch) =>
                syncProcessor.push(
                  batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
                  { waitForProcessing: true },
                ),
            },
            initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
            export: Effect.sync(() => dbState.export()),
            getEventlogData: Effect.sync(() => dbEventlog.export()),
            getSyncState: syncProcessor.syncState,
            sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
          },
          {
            // overrides: testing?.overrides?.clientSession?.leaderThreadProxy
          },
        )

        const initialSnapshot = dbState.export()

        return { leaderThread, initialSnapshot }
      }).pipe(Effect.provide(layer))

      syncInMemoryDb.import(initialSnapshot)

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb: syncInMemoryDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fnUntraced(function* ({ webmeshNode }) {
          // if (devtoolsOptions.enabled) {
          //   yield* Webmesh.connectViaWebSocket({
          //     node: webmeshNode,
          //     url: `ws://${devtoolsOptions.host}:${devtoolsOptions.port}`,
          //     openTimeout: 500,
          //   }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
          // }
        }),
        leaderThread,
        lockStatus,
        clientId,
        sessionId,
        isLeader: true,
        // Not really applicable for node as there is no "reload the app" concept
        registerBeforeUnload: (_onBeforeUnload) => () => {},
      })

      return clientSession
    }).pipe(
      Effect.withSpan('@livestore/adapter-cloudflare:makeAdapter', { attributes: { clientId, sessionId } }),
      Effect.provide(FetchHttpClient.layer),
    )

const getStateDbFileName = (suffix: string) => `state${suffix}@${liveStoreStorageFormatVersion}.db`
