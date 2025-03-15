import type { Adapter, ClientSession, LockStatus, NetworkStatus } from '@livestore/common'
import { Devtools, IntentionalShutdownCause, StoreInterrupted, UnexpectedError } from '@livestore/common'
// TODO bring back - this currently doesn't work due to https://github.com/vitejs/vite/issues/8427
// NOTE We're using a non-relative import here for Vite to properly resolve the import during app builds
// import LiveStoreSharedWorker from '@livestore/adapter-web/internal-shared-worker?sharedworker'
import { EventId, SESSION_CHANGESET_META_TABLE } from '@livestore/common/schema'
import {
  ClientSessionRequestContentscriptMain,
  connectViaWorker,
  makeChannelForConnectedMeshNode,
  makeSessionsChannel,
} from '@livestore/devtools-web-common/web-channel'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import {
  BrowserWorker,
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  ParseResult,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  WebChannel,
  WebLock,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import * as Webmesh from '@livestore/webmesh'

import * as OpfsUtils from '../../opfs-utils.js'
import { readPersistedAppDbFromClientSession, resetPersistedDataFromClientSession } from '../common/persisted-sqlite.js'
import { makeShutdownChannel } from '../common/shutdown-channel.js'
import { DedicatedWorkerDisconnectBroadcast, makeWorkerDisconnectChannel } from '../common/worker-disconnect-channel.js'
import * as WorkerSchema from '../common/worker-schema.js'
import { logDevtoolsUrl } from './client-session-devtools.js'

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = loadSqlite3Wasm()

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    opfs: OpfsUtils,
    runSync: (effect: Effect.Effect<any, any, never>) => Effect.runSync(effect),
    runFork: (effect: Effect.Effect<any, any, never>) => Effect.runFork(effect),
  }
}

export type WebAdapterOptions = {
  worker: ((options: { name: string }) => globalThis.Worker) | (new (options: { name: string }) => globalThis.Worker)
  /**
   * This is mostly an implementation detail and needed to be exposed into app code
   * due to a current Vite limitation (https://github.com/vitejs/vite/issues/8427).
   *
   * In most cases this should look like:
   * ```ts
   * import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
   *
   * const adapter = makeAdapter({
   *   sharedWorker: LiveStoreSharedWorker,
   *   // ...
   * })
   * ```
   */
  sharedWorker:
    | ((options: { name: string }) => globalThis.SharedWorker)
    | (new (options: { name: string }) => globalThis.SharedWorker)
  /**
   * Specifies where to persist data for this adapter
   */
  storage: WorkerSchema.StorageTypeEncoded
  /**
   * Warning: This will reset both the app and mutationlog database.
   * This should only be used during development.
   *
   * @default false
   */
  resetPersistence?: boolean
  /**
   * By default the adapter will initially generate a random clientId (via `nanoid(5)`),
   * store it in `localStorage` and restore it for subsequent client sessions. It's the same across all tabs/windows.
   */
  clientId?: string
  /**
   * By default the adapter will initially generate a random sessionId (via `nanoid(5)`),
   * store it in `sessionStorage` and restore it for subsequent client sessions in the same tab/window.
   */
  sessionId?: string
}

export const makeAdapter =
  (options: WebAdapterOptions): Adapter =>
  ({ schema, storeId, devtoolsEnabled, debugInstanceId, bootStatusQueue, shutdown, connectDevtoolsToStore }) =>
    Effect.gen(function* () {
      yield* ensureBrowserRequirements

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      const LIVESTORE_TAB_LOCK = `livestore-tab-lock-${storeId}`

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      if (options.resetPersistence === true) {
        yield* resetPersistedDataFromClientSession({ storageOptions, storeId })
      }

      // Note on fast-path booting:
      // Instead of waiting for the leader worker to boot and then get a database snapshot from it,
      // we're here trying to get the snapshot directly from storage
      // we usually speeds up the boot process by a lot.
      // We need to be extra careful though to not run into any race conditions or inconsistencies.
      // TODO also verify persisted data
      const dataFromFile = yield* readPersistedAppDbFromClientSession({ storageOptions, storeId, schema })

      // The same across all client sessions (i.e. tabs, windows)
      const clientId = options.clientId ?? getPersistedId(`clientId:${storeId}`, 'local')
      // Unique per client session (i.e. tab, window)
      const sessionId = options.sessionId ?? getPersistedId(`sessionId:${storeId}`, 'session')

      const shutdownChannel = yield* makeShutdownChannel(storeId)
      const workerDisconnectChannel = yield* makeWorkerDisconnectChannel(storeId)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((error) => Effect.sync(() => shutdown(Cause.fail(error)))),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const sharedWebWorker = tryAsFunctionAndNew(options.sharedWorker, { name: `livestore-shared-worker-${storeId}` })

      const sharedWorkerFiber = yield* Worker.makePoolSerialized<typeof WorkerSchema.SharedWorker.Request.Type>({
        size: 1,
        concurrency: 100,
        initialMessage: () =>
          new WorkerSchema.SharedWorker.InitialMessage({
            payload: {
              _tag: 'FromClientSession',
              initialMessage: new WorkerSchema.LeaderWorkerInner.InitialMessage({
                storageOptions,
                storeId,
                clientId,
                devtoolsEnabled,
                debugInstanceId,
              }),
            },
          }),
      }).pipe(
        Effect.provide(BrowserWorker.layer(() => sharedWebWorker)),
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.tapErrorCause((cause) => Effect.sync(() => shutdown(cause))),
        Effect.withSpan('@livestore/adapter-web:client-session:setupSharedWorker'),
        Effect.forkScoped,
      )

      const lockDeferred = yield* Deferred.make<void>()
      // It's important that we resolve the leader election in a blocking way, so there's always a leader.
      // Otherwise mutations could end up being dropped.
      //
      // Sorry for this pun ...
      let gotLocky = yield* WebLock.tryGetDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>(gotLocky ? 'has-lock' : 'no-lock')

      // Ideally we can come up with a simpler implementation that doesn't require this
      const waitForSharedWorkerInitialized = yield* Deferred.make<void>()
      if (gotLocky === false) {
        // Don't need to wait if we're not the leader
        yield* Deferred.succeed(waitForSharedWorkerInitialized, undefined)
      }

      const runLocked = Effect.gen(function* () {
        yield* Effect.logDebug(
          `[@livestore/adapter-web:client-session] ✅ Got lock '${LIVESTORE_TAB_LOCK}' (clientId: ${clientId}, sessionId: ${sessionId})`,
        )

        yield* Effect.addFinalizer(() =>
          Effect.logDebug(`[@livestore/adapter-web:client-session] Releasing lock for '${LIVESTORE_TAB_LOCK}'`),
        )

        yield* SubscriptionRef.set(lockStatus, 'has-lock')

        const mc = new MessageChannel()

        // NOTE we're adding the `storeId` to the worker name to make it unique
        // and adding the `sessionId` to make it easier to debug which session a worker belongs to in logs
        const worker = tryAsFunctionAndNew(options.worker, { name: `livestore-worker-${storeId}-${sessionId}` })

        yield* Worker.makeSerialized<WorkerSchema.LeaderWorkerOuter.Request>({
          initialMessage: () =>
            new WorkerSchema.LeaderWorkerOuter.InitialMessage({ port: mc.port1, storeId, clientId }),
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          UnexpectedError.mapToUnexpectedError,
          Effect.tapErrorCause((cause) => Effect.sync(() => shutdown(cause))),
          Effect.withSpan('@livestore/adapter-web:client-session:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        yield* workerDisconnectChannel.send(DedicatedWorkerDisconnectBroadcast.make({}))

        const sharedWorker = yield* Fiber.join(sharedWorkerFiber)
        yield* sharedWorker.executeEffect(new WorkerSchema.SharedWorker.UpdateMessagePort({ port: mc.port2 })).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.tapErrorCause((cause) => Effect.sync(() => shutdown(cause))),
        )

        yield* Deferred.succeed(waitForSharedWorkerInitialized, undefined)

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // console.log('[@livestore/adapter-web:client-session] Shutting down leader worker')
            // We first try to gracefully shutdown the leader worker and then forcefully terminate it
            // yield* Effect.raceFirst(
            //   sharedWorker
            //     .executeEffect(new WorkerSchema.LeaderWorkerInner.Shutdown({}))
            //     .pipe(Effect.andThen(() => worker.terminate())),
            //   Effect.sync(() => {
            //     console.warn(
            //       '[@livestore/adapter-web:client-session] Worker did not gracefully shutdown in time, terminating it',
            //     )
            //     worker.terminate()
            //   }).pipe(
            //     // Seems like we still need to wait a bit for the worker to terminate
            //     // TODO improve this implementation (possibly via another weblock?)
            //     Effect.delay(1000),
            //   ),
            // )
            // yield* Effect.logDebug('[@livestore/adapter-web:client-session] client-session shutdown. worker terminated')
          }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:lock:shutdown'), Effect.ignoreLogged),
        )

        yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        yield* Effect.logDebug(
          `[@livestore/adapter-web:client-session] ⏳ Waiting for lock '${LIVESTORE_TAB_LOCK}' (sessionId: ${sessionId})`,
        )

        // TODO find a cleaner implementation for the lock handling as we don't make use of the deferred properly right now
        yield* WebLock.waitForDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK).pipe(
          Effect.andThen(() => {
            gotLocky = true
            return runLocked
          }),
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      } else {
        yield* runLocked.pipe(Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const runInWorker = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer E, infer _EI, infer R>
        ? Effect.Effect<A, UnexpectedError | E, R>
        : never =>
        Fiber.join(sharedWorkerFiber).pipe(
          // NOTE we need to wait for the shared worker to be initialized before we can send requests to it
          Effect.tap(() => waitForSharedWorkerInitialized),
          Effect.flatMap((worker) => worker.executeEffect(req) as any),
          // NOTE we want to treat worker requests as atomic and therefore not allow them to be interrupted
          // Interruption usually only happens during leader re-election or store shutdown
          // Effect.uninterruptible,
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/adapter-web:client-session:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/adapter-web:client-session:runInWorker:${req._tag}`),
          Effect.mapError((cause) =>
            Schema.is(UnexpectedError)(cause)
              ? cause
              : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                ? new UnexpectedError({ cause })
                : cause,
          ),
          Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const sharedWorker = yield* Fiber.join(sharedWorkerFiber)
          return sharedWorker.execute(req as any).pipe(
            Stream.mapError((cause) =>
              Schema.is(UnexpectedError)(cause)
                ? cause
                : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                  ? new UnexpectedError({ cause })
                  : cause,
            ),
            Stream.withSpan(`@livestore/adapter-web:client-session:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({
        isConnected: false,
        timestampMs: Date.now(),
        latchClosed: false,
      })

      yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInner.NetworkStatusStream()).pipe(
        Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
        Stream.runDrain,
        Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
        Effect.tapErrorCause((cause) => Effect.sync(() => shutdown(cause))),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInner.BootStatusStream()).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapErrorCause((cause) =>
          Cause.isInterruptedOnly(cause) ? Effect.void : Effect.sync(() => shutdown(cause)),
        ),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Queue.awaitShutdown(bootStatusQueue).pipe(
        Effect.andThen(Fiber.interrupt(bootStatusFiber)),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      // TODO maybe bring back transfering the initially created in-memory db snapshot instead of
      // re-exporting the db
      const initialResult =
        dataFromFile === undefined
          ? yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetRecreateSnapshot()).pipe(
              Effect.map(({ snapshot, migrationsReport }) => ({
                _tag: 'from-leader-worker' as const,
                snapshot,
                migrationsReport,
              })),
            )
          : { _tag: 'fast-path' as const, snapshot: dataFromFile }

      const migrationsReport =
        initialResult._tag === 'from-leader-worker' ? initialResult.migrationsReport : { migrations: [] }

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })

      sqliteDb.import(initialResult.snapshot)

      const numberOfTables =
        sqliteDb.select<{ count: number }>(`select count(*) as count from sqlite_master`)[0]?.count ?? 0
      if (numberOfTables === 0) {
        yield* UnexpectedError.make({
          cause: `Encountered empty or corrupted database`,
          payload: { snapshotByteLength: initialResult.snapshot.byteLength, storageOptions: options.storage },
        })
      }

      // We're restoring the leader head from the SESSION_CHANGESET_META_TABLE, not from the mutationlog db/table
      // in order to avoid exporting/transferring the mutationlog db/table, which is important to speed up the fast path.
      const initialLeaderHeadRes = sqliteDb.select<{
        idGlobal: EventId.GlobalEventId
        idClient: EventId.ClientEventId
      }>(
        `select idGlobal, idClient from ${SESSION_CHANGESET_META_TABLE} order by idGlobal desc, idClient desc limit 1`,
      )[0]

      const initialLeaderHead = initialLeaderHeadRes
        ? EventId.make({ global: initialLeaderHeadRes.idGlobal, client: initialLeaderHeadRes.idClient })
        : EventId.ROOT

      // console.debug('[@livestore/adapter-web:client-session] initialLeaderHead', initialLeaderHead)

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (
            Exit.isFailure(ex) &&
            Exit.isInterrupted(ex) === false &&
            Schema.is(IntentionalShutdownCause)(Cause.squash(ex.cause)) === false &&
            Schema.is(StoreInterrupted)(Cause.squash(ex.cause)) === false
          ) {
            yield* Effect.logError('[@livestore/adapter-web:client-session] client-session shutdown', ex.cause)
          } else {
            yield* Effect.logDebug('[@livestore/adapter-web:client-session] client-session shutdown', gotLocky, ex)
          }

          if (gotLocky) {
            yield* Deferred.succeed(lockDeferred, undefined)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.orDie),
      )

      const devtools: ClientSession['devtools'] = devtoolsEnabled
        ? { enabled: true, pullLatch: yield* Effect.makeLatch(true), pushLatch: yield* Effect.makeLatch(true) }
        : { enabled: false }

      const clientSession = {
        sqliteDb,
        devtools,
        lockStatus,
        clientId,
        sessionId,

        leaderThread: {
          export: runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
            Effect.timeout(10_000),
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-web:client-session:export'),
          ),

          mutations: {
            pull: runInWorkerStream(new WorkerSchema.LeaderWorkerInner.PullStream({ cursor: initialLeaderHead })).pipe(
              Stream.orDie,
            ),
            push: (batch) =>
              runInWorker(new WorkerSchema.LeaderWorkerInner.PushToLeader({ batch })).pipe(
                Effect.withSpan('@livestore/adapter-web:client-session:pushToLeader', {
                  attributes: { batchSize: batch.length },
                }),
              ),
          },

          initialState: { leaderHead: initialLeaderHead, migrationsReport },

          getMutationLogData: runInWorker(new WorkerSchema.LeaderWorkerInner.ExportMutationlog()).pipe(
            Effect.timeout(10_000),
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-web:client-session:getMutationLogData'),
          ),

          getSyncState: runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderSyncState()).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-web:client-session:getLeaderSyncState'),
          ),

          networkStatus,

          sendDevtoolsMessage: (message) =>
            runInWorker(new WorkerSchema.LeaderWorkerInner.ExtraDevtoolsMessage({ message })).pipe(
              UnexpectedError.mapToUnexpectedError,
              Effect.withSpan('@livestore/adapter-web:client-session:devtoolsMessageForLeader'),
            ),
        },

        shutdown,
      } satisfies ClientSession

      if (devtoolsEnabled) {
        yield* Effect.gen(function* () {
          const sharedWorker = yield* Fiber.join(sharedWorkerFiber)

          const webmeshNode = yield* Webmesh.makeMeshNode(`client-session-${storeId}-${clientId}-${sessionId}`)
          globalThis.__debugWebmeshNode = webmeshNode

          yield* logDevtoolsUrl({ clientSession, storeId })

          const sessionsChannel = yield* makeSessionsChannel
          const sessionInfoMessage = Devtools.SessionInfo.SessionInfo.make({ storeId, clientId, sessionId })

          yield* Devtools.SessionInfo.provideSessionInfo({
            webChannel: sessionsChannel,
            sessionInfo: sessionInfoMessage,
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          yield* Effect.gen(function* () {
            const clientSessionStaticChannel = yield* WebChannel.windowChannel2({
              listenWindow: window,
              sendWindow: window,
              schema: { listen: Schema.Void, send: ClientSessionRequestContentscriptMain },
              ids: { own: 'client-session-static', other: 'contentscript-main-static' },
            })

            yield* clientSessionStaticChannel.send(
              ClientSessionRequestContentscriptMain.make({ clientId, sessionId, storeId }),
            )

            const contentscriptMainNodeName = `contentscript-main-${storeId}-${clientId}-${sessionId}`

            const contentscriptMainChannel = yield* WebChannel.windowChannel2({
              listenWindow: window,
              sendWindow: window,
              schema: Webmesh.WebmeshSchema.Packet,
              ids: { own: webmeshNode.nodeName, other: contentscriptMainNodeName },
            })

            yield* webmeshNode.addConnection({
              target: contentscriptMainNodeName,
              connectionChannel: contentscriptMainChannel,
            })
            // yield* Effect.logDebug(
            //   `[@livestore/adapter-web:client-session] initiated connection: ${webmeshNode.nodeName} → contentscript-main`,
            // )

            const extensionWorkerChannel = yield* webmeshNode.makeBroadcastChannel({
              channelName: 'session-info',
              schema: Devtools.SessionInfo.Message,
            })

            yield* Devtools.SessionInfo.provideSessionInfo({
              webChannel: extensionWorkerChannel,
              sessionInfo: sessionInfoMessage,
            })
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          yield* connectViaWorker({ node: webmeshNode, target: 'shared-worker', worker: sharedWorker })

          const storeDevtoolsChannel = yield* makeChannelForConnectedMeshNode({
            node: webmeshNode,
            target: `devtools`,
            schema: { listen: Devtools.ClientSession.MessageToApp, send: Devtools.ClientSession.MessageFromApp },
          })

          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(
          Effect.withSpan('@livestore/adapter-web:client-session:devtools'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      }

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError)

// NOTE for `local` storage we could also use the mutationlog db to store the data
const getPersistedId = (key: string, storageType: 'session' | 'local') => {
  const makeId = () => nanoid(5)

  const storage =
    typeof window === 'undefined'
      ? undefined
      : storageType === 'session'
        ? sessionStorage
        : storageType === 'local'
          ? localStorage
          : shouldNeverHappen(`[@livestore/adapter-web] Invalid storage type: ${storageType}`)

  // in case of a worker, we need the id of the parent window, to keep the id consistent
  // we also need to handle the case where there are multiple workers being spawned by the same window
  if (storage === undefined) {
    return makeId()
  }

  const fullKey = `livestore:${key}`
  const storedKey = storage.getItem(fullKey)

  if (storedKey) return storedKey

  const newKey = makeId()
  storage.setItem(fullKey, newKey)

  return newKey
}

const ensureBrowserRequirements = Effect.gen(function* () {
  const validate = (condition: boolean, label: string) =>
    Effect.gen(function* () {
      if (condition) {
        yield* UnexpectedError.make({
          cause: `[@livestore/adapter-web] Browser not supported. The LiveStore web adapter needs '${label}' to work properly`,
        })
      }
    })

  yield* Effect.all([
    validate(typeof navigator === 'undefined', 'navigator'),
    validate(navigator.locks === undefined, 'navigator.locks'),
    validate(navigator.storage === undefined, 'navigator.storage'),
    validate(typeof window === 'undefined', 'window'),
    validate(typeof sessionStorage === 'undefined', 'sessionStorage'),
  ])
})
