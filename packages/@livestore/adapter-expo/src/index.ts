import './polyfill.js'

import type { Adapter, BootStatus, ClientSessionLeaderThreadProxy, LockStatus, SyncOptions } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, makeClientSession, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import { Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type { Schema, Scope } from '@livestore/utils/effect'
import { Cause, Effect, FetchHttpClient, Fiber, Layer, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'
import * as ExpoApplication from 'expo-application'
import * as SQLite from 'expo-sqlite'
import * as RN from 'react-native'

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
     * `/data/Containers/Data/Application/<APP_UUID>/Documents/ExponentExperienceData/@<USERNAME>/<APPNAME>/SQLite/my-app/<STORE_ID>/livestore-eventlog@3.db`
     */
    subDirectory?: string
  }
  // syncBackend?: TODO
  /** @default android/ios id (see https://docs.expo.dev/versions/latest/sdk/application) */
  clientId?: string
  /** @default 'static' */
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
  (adapterArgs) =>
    Effect.gen(function* () {
      if (IS_NEW_ARCH === false) {
        return yield* UnexpectedError.make({
          cause: new Error(
            'The LiveStore Expo adapter requires the new React Native architecture (aka Fabric). See https://docs.expo.dev/guides/new-architecture',
          ),
        })
      }

      const { schema, shutdown, devtoolsEnabled, storeId, bootStatusQueue, syncPayload } = adapterArgs

      const { storage, clientId = yield* getDeviceId, sessionId = 'static', sync: syncOptions } = options

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((error) => shutdown(Cause.fail(error))),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const devtoolsUrl = getDevtoolsUrl()

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        storeId,
        clientId,
        schema,
        makeSqliteDb,
        syncOptions,
        storage: storage ?? {},
        devtoolsEnabled,
        bootStatusQueue,
        syncPayload,
        devtoolsUrl,
      })

      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })
      sqliteDb.import(initialSnapshot)

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        lockStatus,
        clientId,
        isLeader: true,
        sessionId,
        leaderThread,
        sqliteDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fnUntraced(function* ({ webmeshNode }) {
          if (devtoolsEnabled) {
            yield* Webmesh.connectViaWebSocket({
              node: webmeshNode,
              url: devtoolsUrl,
              openTimeout: 500,
            }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
          }
        }),
        registerBeforeUnload: (_onBeforeUnload) => {
          // RN.AppState.addEventListener('change', (event) => {
          //   console.log('AppState.change', event)
          // })

          return () => {}
        },
      })

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.provide(FetchHttpClient.layer), Effect.tapCauseLogPretty)

const makeLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  storage,
  devtoolsEnabled,
  bootStatusQueue: bootStatusQueueClientSession,
  syncPayload,
  devtoolsUrl,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeExpoSqliteDb
  syncOptions: SyncOptions | undefined
  storage: {
    subDirectory?: string
  }
  devtoolsEnabled: boolean
  bootStatusQueue: Queue.Queue<BootStatus>
  syncPayload: Schema.JsonValue | undefined
  devtoolsUrl: string
}) =>
  Effect.gen(function* () {
    const subDirectory = storage.subDirectory ? storage.subDirectory.replace(/\/$/, '') + '/' : ''
    const pathJoin = (...paths: string[]) => paths.join('/').replaceAll(/\/+/g, '/')
    const directory = pathJoin(SQLite.defaultDatabaseDirectory, subDirectory, storeId)

    const schemaHashSuffix =
      schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()
    const stateDatabaseName = `${'livestore-'}${schemaHashSuffix}@${liveStoreStorageFormatVersion}.db`
    const dbEventlogPath = `${'livestore-'}eventlog@${liveStoreStorageFormatVersion}.db`

    const dbState = yield* makeSqliteDb({ _tag: 'file', databaseName: stateDatabaseName, directory })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'file', databaseName: dbEventlogPath, directory })

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled,
      devtoolsUrl,
      dbState,
      dbEventlog,
      storeId,
      clientId,
    })

    const layer = yield* Layer.memoize(
      makeLeaderThreadLayer({
        clientId,
        dbState,
        dbEventlog,
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
        dbState: db,
        dbEventlog,
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

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = {
        events: {
          pull: ({ cursor }) => syncProcessor.pull({ cursor }),
          push: (batch) =>
            syncProcessor
              .push(
                batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
                { waitForProcessing: true },
              )
              .pipe(Effect.provide(layer), Effect.scoped),
        },
        initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
        export: Effect.sync(() => db.export()),
        getEventlogData: Effect.sync(() => dbEventlog.export()),
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

      const initialSnapshot = db.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  devtoolsUrl,
  dbState,
  dbEventlog,
  storeId,
  clientId,
}: {
  devtoolsEnabled: boolean
  devtoolsUrl: string
  dbState: LeaderSqliteDb
  dbEventlog: LeaderSqliteDb
  storeId: string
  clientId: string
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false) {
      return {
        enabled: false,
      }
    }

    return {
      enabled: true,
      boot: Effect.gen(function* () {
        const persistenceInfo = {
          state: dbState.metadata.persistenceInfo,
          eventlog: dbEventlog.metadata.persistenceInfo,
        }

        const node = yield* Webmesh.makeMeshNode(Devtools.makeNodeName.client.leader({ storeId, clientId }))

        yield* Webmesh.connectViaWebSocket({
          node,
          url: devtoolsUrl,
          openTimeout: 500,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        return { node, persistenceInfo, mode: 'proxy' }
      }),
    }
  })

const getDeviceId = Effect.gen(function* () {
  if (RN.Platform.OS === 'android') {
    return ExpoApplication.getAndroidId()
  } else if (RN.Platform.OS === 'ios') {
    const iosId = yield* Effect.promise(() => ExpoApplication.getIosIdForVendorAsync())
    if (iosId === null) {
      return shouldNeverHappen('getDeviceId: iosId is null')
    }

    return iosId
  } else {
    return shouldNeverHappen(`getDeviceId: Unsupported platform: ${RN.Platform.OS}`)
  }
})

const getDevtoolsUrl = () => {
  return process.env.EXPO_PUBLIC_LIVESTORE_DEVTOOLS_URL ?? `http://localhost:4242`
}
