import type { Adapter, ClientSession, LockStatus, NetworkStatus } from '@livestore/common'
import { Devtools, IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
// TODO bring back - this currently doesn't work due to https://github.com/vitejs/vite/issues/8427
// NOTE We're using a non-relative import here for Vite to properly resolve the import during app builds
// import LiveStoreSharedWorker from '@livestore/web/internal-shared-worker?sharedworker'
import { ShutdownChannel } from '@livestore/common/leader-thread'
import type { MutationEvent } from '@livestore/common/schema'
import { EventId, SESSION_CHANGESET_META_TABLE } from '@livestore/common/schema'
import { makeWebDevtoolsChannel } from '@livestore/devtools-web-common/web-channel'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import {
  BrowserWorker,
  BucketQueue,
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
  WebLock,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import * as OpfsUtils from '../../opfs-utils.js'
import { readPersistedAppDbFromClientSession, resetPersistedDataFromClientSession } from '../common/persisted-sqlite.js'
import { makeShutdownChannel } from '../common/shutdown-channel.js'
import * as WorkerSchema from '../common/worker-schema.js'
import { bootDevtools } from './client-session-devtools.js'

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = loadSqlite3Wasm()

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    opfs: OpfsUtils,
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
   * import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
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
      const clientId = getPersistedId(`clientId:${storeId}`, 'local')
      // Unique per client session (i.e. tab, window)
      const sessionId = getPersistedId(`sessionId:${storeId}`, 'session')

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.filter(Schema.is(IntentionalShutdownCause)),
        Stream.tap((msg) => shutdown(Cause.fail(msg))),
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
        Effect.tapErrorCause(shutdown),
        Effect.withSpan('@livestore/web:client-session:setupSharedWorker'),
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
          `[@livestore/web:client-session] ✅ Got lock '${LIVESTORE_TAB_LOCK}' (sessionId: ${sessionId})`,
        )

        yield* Effect.addFinalizer(() =>
          Effect.logDebug(`[@livestore/web:client-session] Releasing lock for '${LIVESTORE_TAB_LOCK}'`),
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
          Effect.tapErrorCause(shutdown),
          Effect.withSpan('@livestore/web:client-session:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        yield* shutdownChannel.send(ShutdownChannel.DedicatedWorkerDisconnectBroadcast.make({}))

        const sharedWorker = yield* Fiber.join(sharedWorkerFiber)
        yield* sharedWorker
          .executeEffect(new WorkerSchema.SharedWorker.UpdateMessagePort({ port: mc.port2 }))
          .pipe(UnexpectedError.mapToUnexpectedError, Effect.tapErrorCause(shutdown))

        yield* Deferred.succeed(waitForSharedWorkerInitialized, undefined)

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // console.log('[@livestore/web:client-session] Shutting down leader worker')

            // We first try to gracefully shutdown the leader worker and then forcefully terminate it
            yield* Effect.raceFirst(
              sharedWorker
                .executeEffect(new WorkerSchema.LeaderWorkerInner.Shutdown({}))
                .pipe(Effect.andThen(() => worker.terminate())),

              Effect.sync(() => {
                console.warn(
                  '[@livestore/web:client-session] Worker did not gracefully shutdown in time, terminating it',
                )
                worker.terminate()
              }).pipe(
                // Seems like we still need to wait a bit for the worker to terminate
                // TODO improve this implementation (possibly via another weblock?)
                Effect.delay(1000),
              ),
            )

            // yield* Effect.logDebug('[@livestore/web:client-session] client-session shutdown. worker terminated')
          }).pipe(Effect.withSpan('@livestore/web:client-session:lock:shutdown'), Effect.ignoreLogged),
        )

        yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/web:client-session:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        yield* Effect.logDebug(
          `[@livestore/web:client-session] ⏳ Waiting for lock '${LIVESTORE_TAB_LOCK}' (sessionId: ${sessionId})`,
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
            label: `@livestore/web:client-session:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/web:client-session:runInWorker:${req._tag}`),
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
            Stream.withSpan(`@livestore/web:client-session:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({ isConnected: false, timestampMs: Date.now() })

      yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInner.NetworkStatusStream()).pipe(
        Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
        Stream.runDrain,
        Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
        Effect.tapErrorCause(shutdown),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInner.BootStatusStream()).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapErrorCause((cause) => (Cause.isInterruptedOnly(cause) ? Effect.void : shutdown(cause))),
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
      const initialSnapshot = dataFromFile ?? (yield* runInWorker(new WorkerSchema.LeaderWorkerInner.Export()))

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })

      sqliteDb.import(initialSnapshot)

      const numberOfTables =
        sqliteDb.select<{ count: number }>(`select count(*) as count from sqlite_master`)[0]?.count ?? 0
      if (numberOfTables === 0) {
        yield* UnexpectedError.make({
          cause: `Encountered empty or corrupted database`,
          payload: { snapshotByteLength: initialSnapshot.byteLength, storageOptions: options.storage },
        })
      }

      const mutationHead = sqliteDb.select<{ idGlobal: EventId.GlobalEventId; idLocal: EventId.LocalEventId }>(
        `select idGlobal, idLocal from ${SESSION_CHANGESET_META_TABLE} order by idGlobal desc, idLocal desc limit 1`,
      )[0]

      const initialMutationEventId = mutationHead
        ? EventId.make({ global: mutationHead.idGlobal, local: mutationHead.idLocal })
        : EventId.ROOT

      // console.debug('[@livestore/web:client-session] initialMutationEventId', initialMutationEventId)

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (
            Exit.isFailure(ex) &&
            Exit.isInterrupted(ex) === false &&
            Schema.is(IntentionalShutdownCause)(ex.cause) === false
          ) {
            yield* Effect.logError('[@livestore/web:client-session] client-session shutdown', ex.cause)
          } else {
            yield* Effect.logDebug('[@livestore/web:client-session] client-session shutdown', gotLocky, ex)
          }

          if (gotLocky) {
            yield* Deferred.succeed(lockDeferred, undefined)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.orDie),
      )

      const pushQueue = yield* BucketQueue.make<MutationEvent.AnyEncoded>()

      yield* Effect.gen(function* () {
        const batch = yield* BucketQueue.takeBetween(pushQueue, 1, 100)
        yield* runInWorker(new WorkerSchema.LeaderWorkerInner.PushToLeader({ batch })).pipe(
          Effect.withSpan('@livestore/web:client-session:pushToLeader', {
            attributes: { batchSize: batch.length },
          }),
        )
      }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)

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
            Effect.withSpan('@livestore/web:client-session:export'),
          ),

          mutations: {
            pull: runInWorkerStream(
              new WorkerSchema.LeaderWorkerInner.PullStream({ cursor: initialMutationEventId }),
            ).pipe(Stream.orDie),

            // NOTE instead of sending the worker message right away, we're batching the events in order to
            // - maintain a consistent order of events
            // - improve efficiency by reducing the number of messages
            push: (batch) => BucketQueue.offerAll(pushQueue, batch),

            initialMutationEventId,
          },

          getMutationLogData: runInWorker(new WorkerSchema.LeaderWorkerInner.ExportMutationlog()).pipe(
            Effect.timeout(10_000),
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/web:client-session:getMutationLogData'),
          ),

          getSyncState: runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderSyncState()).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/web:client-session:getLeaderSyncState'),
          ),

          networkStatus,

          sendDevtoolsMessage: (message) =>
            runInWorker(new WorkerSchema.LeaderWorkerInner.ExtraDevtoolsMessage({ message })).pipe(
              UnexpectedError.mapToUnexpectedError,
              Effect.withSpan('@livestore/web:client-session:devtoolsMessageForLeader'),
            ),
        },

        shutdown,
      } satisfies ClientSession

      if (devtoolsEnabled) {
        // yield* bootDevtools({ client-session, waitForDevtoolsWebBridgePort, connectToDevtools, storeId })
        yield* Effect.gen(function* () {
          const sharedWorker = yield* Fiber.join(sharedWorkerFiber)

          yield* bootDevtools({ clientSession, storeId })

          // TODO re-enable browser extension as well
          const storeDevtoolsChannel = yield* makeWebDevtoolsChannel({
            nodeName: `client-session-${storeId}-${clientId}-${sessionId}`,
            target: `devtools`,
            schema: { listen: Devtools.MessageToAppClientSession, send: Devtools.MessageFromAppClientSession },
            worker: sharedWorker,
            workerTargetName: 'shared-worker',
          })

          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.withSpan('@livestore/web:client-session:devtools'), Effect.tapCauseLogPretty, Effect.forkScoped)
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
          : shouldNeverHappen(`[@livestore/web] Invalid storage type: ${storageType}`)

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
          cause: `[@livestore/web] Browser not supported. The LiveStore web adapter needs '${label}' to work properly`,
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
