import './polyfill.ts'

import {
  type Adapter,
  type BootStatus,
  ClientSessionLeaderThreadProxy,
  Devtools,
  IntentionalShutdownCause,
  type LockStatus,
  liveStoreStorageFormatVersion,
  makeClientSession,
  type SyncOptions,
  UnexpectedError,
} from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import { Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type { Schema, Scope } from '@livestore/utils/effect'
import {
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  Layer,
  Queue,
  Schedule,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'
import * as ExpoApplication from 'expo-application'
import * as SQLite from 'expo-sqlite'
import * as RN from 'react-native'

import type { MakeExpoSqliteDb } from './make-sqlite-db.ts'
import { makeSqliteDb } from './make-sqlite-db.ts'
import { makeShutdownChannel } from './shutdown-channel.ts'

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
  /**
   * Warning: This will reset both the app and eventlog database. This should only be used during development.
   *
   * @default false
   */
  resetPersistence?: boolean
}

// Expo Go with the New Architecture enables Fabric and TurboModules, but may not run in "bridgeless" mode.
// Rely on Fabric/TurboModules feature detection instead of RN$Bridgeless.
const IS_NEW_ARCH =
  // Fabric global – set when the new renderer is enabled
  Boolean((globalThis as any).nativeFabricUIManager) ||
  // TurboModule proxy – indicates new arch TurboModules
  Boolean((globalThis as any).__turboModuleProxy)

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

      const { schema, shutdown, devtoolsEnabled, storeId, bootStatusQueue, syncPayloadEncoded, syncPayloadSchema } =
        adapterArgs

      const {
        storage,
        clientId = yield* getDeviceId,
        sessionId = 'static',
        sync: syncOptions,
        resetPersistence = false,
      } = options

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      if (resetPersistence === true) {
        yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'adapter-reset' }))

        yield* resetExpoPersistence({ storeId, storage, schema })
      }

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((cause) =>
          shutdown(cause._tag === 'LiveStore.IntentionalShutdownCause' ? Exit.succeed(cause) : Exit.fail(cause)),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const devtoolsUrl = devtoolsEnabled ? getDevtoolsUrl().toString() : 'ws://127.0.0.1:4242'

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        storeId,
        clientId,
        schema,
        makeSqliteDb,
        syncOptions,
        storage: storage ?? {},
        devtoolsEnabled,
        bootStatusQueue,
        syncPayloadEncoded,
        syncPayloadSchema,
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
        origin: undefined,
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
  syncPayloadEncoded,
  syncPayloadSchema,
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
  syncPayloadEncoded: Schema.Schema.Encoded<Schema.Schema.AnyNoContext> | undefined
  syncPayloadSchema: Schema.Schema.AnyNoContext
  devtoolsUrl: string
}) =>
  Effect.gen(function* () {
    const { directory, stateDatabaseName, eventlogDatabaseName } = resolveExpoPersistencePaths({
      storeId,
      storage,
      schema,
    })

    const dbState = yield* makeSqliteDb({ _tag: 'file', databaseName: stateDatabaseName, directory })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'file', databaseName: eventlogDatabaseName, directory })

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
        syncPayloadEncoded,
        syncPayloadSchema,
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
        networkStatus,
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

      const leaderThread = ClientSessionLeaderThreadProxy.of({
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
        syncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
        networkStatus,
      })

      const initialSnapshot = db.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

const resolveExpoPersistencePaths = ({
  storeId,
  storage,
  schema,
}: {
  storeId: string
  storage: { subDirectory?: string } | undefined
  schema: LiveStoreSchema
}) => {
  const subDirectory = storage?.subDirectory ? `${storage.subDirectory.replace(/\/$/, '')}/` : ''
  const pathJoin = (...paths: string[]) => paths.join('/').replaceAll(/\/+/g, '/')
  const directory = pathJoin(SQLite.defaultDatabaseDirectory, subDirectory, storeId)

  const schemaHashSuffix =
    schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()
  const stateDatabaseName = `livestore-${schemaHashSuffix}@${liveStoreStorageFormatVersion}.db`
  const eventlogDatabaseName = `livestore-eventlog@${liveStoreStorageFormatVersion}.db`

  return { directory, stateDatabaseName, eventlogDatabaseName }
}

const resetExpoPersistence = ({
  storeId,
  storage,
  schema,
}: {
  storeId: string
  storage: MakeDbOptions['storage']
  schema: LiveStoreSchema
}) =>
  Effect.try({
    try: () => {
      const { directory, stateDatabaseName, eventlogDatabaseName } = resolveExpoPersistencePaths({
        storeId,
        storage,
        schema,
      })

      SQLite.deleteDatabaseSync(stateDatabaseName, directory)
      SQLite.deleteDatabaseSync(eventlogDatabaseName, directory)
    },
    catch: (cause) =>
      new UnexpectedError({
        cause,
        note: `@livestore/adapter-expo: Failed to reset persistence for store ${storeId}`,
      }),
  }).pipe(
    Effect.retry({ schedule: Schedule.exponentialBackoff10Sec }),
    Effect.withSpan('@livestore/adapter-expo:resetPersistence', { attributes: { storeId } }),
  )

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
  Effect.sync(() => {
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

/**
 * Given that an Expo app is running in special environments (e.g. on a real device with separate IP address or in an Android emulator),
 * we need to determine the correct URL to connect to the devtools server.
 */
const getDevtoolsUrl = () => {
  const url = new URL(process.env.EXPO_PUBLIC_LIVESTORE_DEVTOOLS_URL ?? `ws://0.0.0.0:4242`)
  const port = url.port

  const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer').default
  const devServer = getDevServer().url.replace(/\/?$/, '') as string

  const devServerUrl = new URL(devServer)

  return new URL(`ws://${devServerUrl.hostname}:${port}`)
}
