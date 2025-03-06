import type { Adapter, ClientSession, ClientSessionLeaderThreadProxy, LockStatus, SyncOptions } from '@livestore/common'
import { liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import { getClientHeadFromDb, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import { Cause, Effect, FetchHttpClient, Layer, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import * as SQLite from 'expo-sqlite'

import type { MakeExpoSqliteDb } from './make-sqlite-db.js'
import { makeSqliteDb } from './make-sqlite-db.js'
import { makeShutdownChannel } from './shutdown-channel.js'

export type MakeDbOptions = {
  sync?: SyncOptions
  storage?: {
    /**
     * Relative to expo-sqlite's default directory
     *
     * Example of a resulting path for `subDirectory: 'my-app'`:
     * `/data/Containers/Data/Application/<APP_UUID>/Documents/ExponentExperienceData/@<USERNAME>/<APPNAME>/SQLite/my-app/<STORE_ID>/livestore-mutationlog@3.db`
     */
    subDirectory?: string
  }
  // syncBackend?: TODO
  /** @default 'expo' */
  clientId?: string
  /** @default nanoid(6) */
  sessionId?: string
}

// TODO refactor with leader-thread code from `@livestore/common/leader-thread`
export const makeAdapter =
  (options: MakeDbOptions = {}): Adapter =>
  ({ schema, connectDevtoolsToStore, shutdown, devtoolsEnabled, storeId, bootStatusQueue, debugInstanceId }) =>
    Effect.gen(function* () {
      const { storage, clientId = 'expo', sessionId = nanoid(6), sync: syncOptions } = options

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
        storage: storage ?? {},
      })

      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })
      sqliteDb.import(initialSnapshot)

      const clientSession = {
        devtools: { enabled: false },
        lockStatus,
        clientId,
        sessionId,
        leaderThread,
        shutdown: () => Effect.dieMessage('TODO implement shutdown'),
        sqliteDb,
      } satisfies ClientSession

      if (devtoolsEnabled) {
        // yield* Effect.gen(function* () {
        //   const storeDevtoolsChannel = yield* makeNodeDevtoolsChannel({
        //     nodeName: `client-session-${storeId}-${clientId}-${sessionId}`,
        //     target: `devtools`,
        //     url: `ws://localhost:${devtoolsOptions.port}`,
        //     schema: {
        //       listen: Devtools.ClientSession.MessageToApp,
        //       send: Devtools.ClientSession.MessageFromApp,
        //     },
        //   })
        //   yield* connectDevtoolsToStore(storeDevtoolsChannel)
        // }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      return clientSession
    }).pipe(
      Effect.mapError((cause) => (cause._tag === 'LiveStore.UnexpectedError' ? cause : new UnexpectedError({ cause }))),
      Effect.tapCauseLogPretty,
    )

const makeLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  storage,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeExpoSqliteDb
  syncOptions: SyncOptions | undefined
  storage: {
    subDirectory?: string
  }
}) =>
  Effect.gen(function* () {
    const subDirectory = storage.subDirectory ? storage.subDirectory.replace(/\/$/, '') + '/' : ''
    const pathJoin = (...paths: string[]) => paths.join('/').replaceAll(/\/+/g, '/')
    const directory = pathJoin(SQLite.defaultDatabaseDirectory, subDirectory, storeId)

    const readModelDatabaseName = `${'livestore-'}${schema.hash}@${liveStoreStorageFormatVersion}.db`
    const dbMutationLogPath = `${'livestore-'}mutationlog@${liveStoreStorageFormatVersion}.db`

    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        dbReadModel: yield* makeSqliteDb({ _tag: 'expo', databaseName: readModelDatabaseName, directory }),
        dbMutationLog: yield* makeSqliteDb({ _tag: 'expo', databaseName: dbMutationLogPath, directory }),
        devtoolsOptions: { enabled: false },
        makeSqliteDb,
        schema,
        // NOTE we're creating a separate channel here since you can't listen to your own channel messages
        shutdownChannel: yield* makeShutdownChannel(storeId),
        storeId,
        syncOptions,
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
          pull: Stream.fromQueue(pullQueue),
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
