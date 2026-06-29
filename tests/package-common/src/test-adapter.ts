import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  type LockStatus,
  type MakeSqliteDb,
  makeClientSession,
  migrateDb,
  type SqliteDb,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import {
  configureConnection,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  ShutdownChannel,
  streamEventsWithSyncState,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import {
  Effect,
  Deferred,
  Exit,
  FetchHttpClient,
  Layer,
  Queue,
  Result,
  Stream,
  SubscriptionRef,
  WebChannel,
  type Schema,
  type Scope,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

export type TestingOverrides = {
  clientSession?: {
    leaderThreadProxy?: (
      original: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy,
    ) => Partial<ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy>
  }
  makeLeaderThread?: (makeSqliteDb: MakeSqliteDb) => Effect.Effect<
    {
      dbEventlog: SqliteDb
      dbState: SqliteDb
    },
    UnknownError
  >
}

export const makeTestAdapter = ({
  clientId = 'test-client',
  sessionId = 'static',
  sync,
  importSnapshot,
  testing,
}: {
  clientId?: string
  sessionId?: string
  sync?: SyncOptions
  importSnapshot?: Uint8Array<ArrayBuffer>
  testing?: { overrides?: TestingOverrides }
} = {}): Adapter =>
  ((adapterArgs) =>
    Effect.gen(function* () {
      const { schema, storeId, syncPayloadEncoded, syncPayloadSchema } = adapterArgs
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const shutdownChannel = yield* makeShutdownChannel(storeId)
      yield* shutdownChannel.listen.pipe(
        Stream.mapEffect(Effect.fromResult),
        Stream.tap((cause) =>
          adapterArgs.shutdown(cause._tag === 'IntentionalShutdownCause' ? Exit.succeed(cause) : Exit.fail(cause)),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
        Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
      )
      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory' }).pipe(Effect.orDie)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const { leaderThread, initialSnapshot } = yield* makeLocalLeaderThread({
        storeId,
        clientId,
        schema,
        makeSqliteDb,
        syncOptions: sync,
        syncPayloadEncoded,
        syncPayloadSchema,
        testing,
        shutdownChannel,
      }).pipe(UnknownError.mapToUnknownError)

      syncInMemoryDb.import(importSnapshot ?? initialSnapshot)
      if (importSnapshot !== undefined) {
        yield* migrateDb({ db: syncInMemoryDb, schema })
      }
      syncInMemoryDb.debug.head = leaderThread.initialState.leaderHead

      return yield* makeClientSession({
        ...adapterArgs,
        sqliteDb: syncInMemoryDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: () => Effect.void,
        leaderThread,
        lockStatus,
        clientId,
        sessionId,
        isLeader: true,
        registerBeforeUnload: () => () => {},
        origin: undefined,
      })
    }).pipe(
      Effect.withSpan('@local/tests-package-common:test-adapter'),
      Effect.provide(Layer.mergeAll(PlatformNode.NodeFileSystem.layer, FetchHttpClient.layer)),
    )) satisfies Adapter

const makeLocalLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  syncPayloadEncoded,
  syncPayloadSchema,
  testing,
  shutdownChannel,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  syncPayloadEncoded: Schema.Json | undefined
  syncPayloadSchema: Schema.Decoder<Schema.Json> | undefined
  testing?: { overrides?: TestingOverrides }
  shutdownChannel: ShutdownChannel.ShutdownChannel
}) =>
  Effect.gen(function* () {
    const services = yield* Effect.context()

    const makeDb = (kind: 'state' | 'eventlog') => {
      if (testing?.overrides?.makeLeaderThread !== undefined) {
        return testing.overrides
          .makeLeaderThread(makeSqliteDb)
          .pipe(Effect.map(({ dbEventlog, dbState }) => (kind === 'state' ? dbState : dbEventlog)))
      }

      return makeSqliteDb({
        _tag: 'in-memory',
        configureDb: (db: SqliteDb) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.runSyncWith(services)),
      })
    }

    const [dbState, dbEventlog] = yield* Effect.all([makeDb('state'), makeDb('eventlog')], { concurrency: 2 })

    const layer = yield* Layer.build(
      makeLeaderThreadLayer({
        schema,
        storeId,
        clientId,
        makeSqliteDb,
        syncOptions,
        dbState,
        dbEventlog,
        devtoolsOptions: { enabled: false },
        shutdownChannel,
        syncPayloadEncoded,
        syncPayloadSchema,
      }),
    )

    return yield* Effect.gen(function* () {
      const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = ClientSessionLeaderThreadProxy.of(
        {
          events: {
            pull: ({ cursor }) => syncProcessor.pull({ cursor }),
            push: (batch) => syncProcessor.push(batch.map((item) => new LiveStoreEvent.Client.EncodedWithMeta(item))),
            stream: (options) =>
              streamEventsWithSyncState({
                dbEventlog,
                syncState: syncProcessor.syncState,
                options,
              }),
          },
          initialState: {
            leaderHead: initialLeaderHead,
            migrationsReport: initialState.migrationsReport,
            storageMode: 'in-memory',
          },
          export: Effect.sync(() => dbState.export()),
          getEventlogData: Effect.sync(() => dbEventlog.export()),
          syncState: syncProcessor.syncState,
          sendDevtoolsMessage: (message) => Queue.offer(extraIncomingMessagesQueue, message),
          networkStatus,
        },
        { ...omitUndefineds({ overrides: testing?.overrides?.clientSession?.leaderThreadProxy }) },
      )

      return { leaderThread, initialSnapshot: dbState.export() }
    }).pipe(Effect.provide(layer))
  })

const makeShutdownChannel = (storeId: string): Effect.Effect<ShutdownChannel.ShutdownChannel, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<typeof ShutdownChannel.All.Type>()
    const closedDeferred = yield* Deferred.make<void>()

    return {
      [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
      send: (message) => Queue.offer(queue, message),
      listen: Stream.fromQueue(queue).pipe(Stream.map(Result.succeed)),
      closedDeferred,
      shutdown: Queue.shutdown(queue).pipe(Effect.asVoid),
      schema: {
        listen: ShutdownChannel.All,
        send: ShutdownChannel.All,
      },
      supportsTransferables: false,
      debugInfo: { storeId },
    } satisfies ShutdownChannel.ShutdownChannel
  }).pipe(Effect.withSpan('@local/tests-package-common:test-adapter:shutdown-channel', { attributes: { storeId } }))
