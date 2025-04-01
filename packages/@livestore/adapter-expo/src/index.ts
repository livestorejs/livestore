import './polyfill.js'

import type {
  Adapter,
  BootStatus,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  SyncOptions,
} from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import { getClientHeadFromDb, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import * as DevtoolsExpo from '@livestore/devtools-expo-common/web-channel'
import type { Schema, Scope } from '@livestore/utils/effect'
import { Cause, Effect, FetchHttpClient, Fiber, Layer, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
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
  /** @default 'expo' */
  sessionId?: string
}

declare global {
  // eslint-disable-next-line no-var
  var RN$Bridgeless: boolean | undefined
}

const IS_NEW_ARCH = globalThis.RN$Bridgeless === true

// TODO refactor with leader-thread code from `@livestore/common/leader-thread`
export const makePersistedAdapter =
  (options: MakeDbOptions = {}): Adapter =>
  ({ schema, connectDevtoolsToStore, shutdown, devtoolsEnabled, storeId, bootStatusQueue, syncPayload }) =>
    Effect.gen(function* () {
      if (IS_NEW_ARCH === false) {
        return yield* UnexpectedError.make({
          cause: new Error(
            'The LiveStore Expo adapter requires the new React Native architecture (aka Fabric). See https://docs.expo.dev/guides/new-architecture',
          ),
        })
      }

      const { storage, clientId = 'expo', sessionId = 'expo', sync: syncOptions } = options

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

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

      const devtoolsWebmeshNode = devtoolsEnabled
        ? yield* DevtoolsExpo.makeExpoDevtoolsConnectedMeshNode({
            nodeName: `expo-${storeId}-${clientId}-${sessionId}`,
            target: `devtools-${storeId}-${clientId}-${sessionId}`,
          })
        : undefined

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        storeId,
        clientId,
        sessionId,
        schema,
        makeSqliteDb,
        syncOptions,
        storage: storage ?? {},
        devtoolsEnabled,
        devtoolsWebmeshNode,
        bootStatusQueue,
        syncPayload,
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
        yield* Effect.gen(function* () {
          const sessionInfoChannel = yield* DevtoolsExpo.makeExpoDevtoolsBroadcastChannel({
            channelName: 'devtools-expo-session-info',
            schema: Devtools.SessionInfo.Message,
          })

          yield* Devtools.SessionInfo.provideSessionInfo({
            webChannel: sessionInfoChannel,
            sessionInfo: Devtools.SessionInfo.SessionInfo.make({ clientId, sessionId, storeId }),
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          const storeDevtoolsChannel = yield* DevtoolsExpo.makeChannelForConnectedMeshNode({
            target: `devtools-${storeId}-${clientId}-${sessionId}`,
            node: devtoolsWebmeshNode!,
            schema: { listen: Devtools.ClientSession.MessageToApp, send: Devtools.ClientSession.MessageFromApp },
            channelType: 'clientSession',
          })

          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      return clientSession
    }).pipe(
      Effect.mapError((cause) => (cause._tag === 'LiveStore.UnexpectedError' ? cause : new UnexpectedError({ cause }))),
      Effect.tapCauseLogPretty,
    )

const makeLeaderThread = ({
  storeId,
  clientId,
  sessionId,
  schema,
  makeSqliteDb,
  syncOptions,
  storage,
  devtoolsEnabled,
  devtoolsWebmeshNode,
  bootStatusQueue: bootStatusQueueClientSession,
  syncPayload,
}: {
  storeId: string
  clientId: string
  sessionId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeExpoSqliteDb
  syncOptions: SyncOptions | undefined
  storage: {
    subDirectory?: string
  }
  devtoolsEnabled: boolean
  devtoolsWebmeshNode: MeshNode | undefined
  bootStatusQueue: Queue.Queue<BootStatus>
  syncPayload: Schema.JsonValue | undefined
}) =>
  Effect.gen(function* () {
    const subDirectory = storage.subDirectory ? storage.subDirectory.replace(/\/$/, '') + '/' : ''
    const pathJoin = (...paths: string[]) => paths.join('/').replaceAll(/\/+/g, '/')
    const directory = pathJoin(SQLite.defaultDatabaseDirectory, subDirectory, storeId)

    const readModelDatabaseName = `${'livestore-'}${schema.hash}@${liveStoreStorageFormatVersion}.db`
    const dbMutationLogPath = `${'livestore-'}mutationlog@${liveStoreStorageFormatVersion}.db`

    const dbReadModel = yield* makeSqliteDb({ _tag: 'file', databaseName: readModelDatabaseName, directory })
    const dbMutationLog = yield* makeSqliteDb({ _tag: 'file', databaseName: dbMutationLogPath, directory })

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled,
      dbReadModel,
      dbMutationLog,
      storeId,
      clientId,
      sessionId,
      devtoolsWebmeshNode,
    })

    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        dbReadModel,
        dbMutationLog,
        devtoolsOptions,
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
        extraIncomingMessagesQueue,
        initialState,
        bootStatusQueue,
      } = yield* LeaderThreadCtx

      const bootStatusFiber = yield* Queue.takeBetween(bootStatusQueue, 1, 1000).pipe(
        Effect.tap((bootStatus) => Queue.offerAll(bootStatusQueueClientSession, bootStatus)),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Queue.awaitShutdown(bootStatusQueueClientSession).pipe(
        Effect.andThen(Fiber.interrupt(bootStatusFiber)),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const initialLeaderHead = getClientHeadFromDb(dbMutationLog)

      const leaderThread = {
        mutations: {
          pull: ({ cursor }) => syncProcessor.pull({ since: cursor }),
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
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

      const initialSnapshot = db.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  dbReadModel,
  dbMutationLog,
  storeId,
  clientId,
  sessionId,
  devtoolsWebmeshNode,
}: {
  devtoolsEnabled: boolean
  dbReadModel: LeaderSqliteDb
  dbMutationLog: LeaderSqliteDb
  storeId: string
  clientId: string
  sessionId: string
  devtoolsWebmeshNode: MeshNode | undefined
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false) {
      return {
        enabled: false,
      }
    }

    return {
      enabled: true,
      makeBootContext: Effect.gen(function* () {
        const devtoolsWebChannel = yield* DevtoolsExpo.makeChannelForConnectedMeshNode({
          node: devtoolsWebmeshNode!,
          target: `devtools-${storeId}-${clientId}-${sessionId}`,
          schema: { listen: Devtools.Leader.MessageToApp, send: Devtools.Leader.MessageFromApp },
          channelType: 'leader',
        })

        return {
          devtoolsWebChannel,
          persistenceInfo: {
            readModel: dbReadModel.metadata.persistenceInfo,
            mutationLog: dbMutationLog.metadata.persistenceInfo,
          },
        }
      }),
    }
  })
