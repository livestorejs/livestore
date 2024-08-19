import type { Coordinator, LockStatus, NetworkStatus, StoreAdapterFactory } from '@livestore/common'
import { Devtools, IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { tryAsFunctionAndNew } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import type { Serializable } from '@livestore/utils/effect'
import {
  BrowserWorker,
  Cause,
  Chunk,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  WebChannel,
  WebLock,
  Worker,
} from '@livestore/utils/effect'

// TODO bring back - this currently doesn't work due to https://github.com/vitejs/vite/issues/8427
// NOTE We're using a non-relative import here for Vite to properly resolve the import during app builds
// import LiveStoreSharedWorker from '@livestore/web/internal-shared-worker?sharedworker'
import { BCMessage } from '../common/index.js'
import * as OpfsUtils from '../opfs-utils.js'
import { WaSqlite } from '../sqlite/index.js'
import { bootDevtools } from './coordinator-devtools.js'
import { readPersistedAppDbFromCoordinator, resetPersistedDataFromCoordinator } from './persisted-sqlite.js'
import { DedicatedWorkerDisconnectBroadcast, makeShutdownChannel } from './shutdown-channel.js'
import * as WorkerSchema from './worker-schema.js'

// NOTE we're starting to initialize the sqlite wasm binary here to speed things up
const sqlite3Promise = WaSqlite.loadSqlite3Wasm()

// @ts-expect-error TODO fix types
if (import.meta.env.DEV) {
  // @ts-expect-error TODO fix types
  globalThis.__opfsUtils = OpfsUtils
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
  syncing?: WorkerSchema.SyncingType
  /**
   * Warning: This will reset both the app and mutationlog database.
   * This should only be used during development.
   *
   * @default false
   */
  resetPersistence?: boolean
}

export const makeAdapter =
  (options: WebAdapterOptions): StoreAdapterFactory =>
  ({ schema, devtoolsEnabled, bootStatusQueue, shutdown, connectDevtoolsToStore }) =>
    Effect.gen(function* () {
      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const sqlite3 = yield* Effect.promise(() => sqlite3Promise)

      const executionBacklogQueue = yield* Queue.unbounded<WorkerSchema.ExecutionBacklogItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const schemaKey = schema.key

      const LIVESTORE_TAB_LOCK = `livestore-tab-lock-${schemaKey}`

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

      if (options.resetPersistence === true) {
        yield* resetPersistedDataFromCoordinator({ storageOptions, schemaKey })
      }

      const broadcastChannel = yield* WebChannel.broadcastChannel({
        channelName: `livestore-sync-${schema.hash}-${schemaKey}`,
        listenSchema: BCMessage.Message,
        sendSchema: BCMessage.Message,
      })

      // TODO also verify persisted data
      const dataFromFile = yield* readPersistedAppDbFromCoordinator({
        storageOptions,
        schemaKey,
        schemaHashSuffix,
      })

      const appHostId = getAppHostId(schema.key)

      const shutdownChannel = yield* makeShutdownChannel(schema.key)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.filter(Schema.is(IntentionalShutdownCause)),
        Stream.tap((msg) => shutdown(Cause.fail(msg))),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const sharedWorker = tryAsFunctionAndNew(options.sharedWorker, { name: `livestore-shared-worker-${schemaKey}` })

      const sharedWorkerDeferred = yield* Worker.makePoolSerialized<typeof WorkerSchema.SharedWorker.Request.Type>({
        size: 1,
        concurrency: 100,
        initialMessage: () =>
          new WorkerSchema.SharedWorker.InitialMessage({
            payload: {
              _tag: 'FromCoordinator',
              schemaKey,
              initialMessage: new WorkerSchema.DedicatedWorkerInner.InitialMessage({
                storageOptions,
                needsRecreate: dataFromFile === undefined,
                syncOptions: options.syncing,
                devtoolsEnabled,
              }),
            },
          }),
      }).pipe(
        Effect.provide(BrowserWorker.layer(() => sharedWorker)),
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.tapErrorCause(shutdown),
        Effect.withSpan('@livestore/web:coordinator:setupSharedWorker'),
        Effect.toForkedDeferred,
      )

      const lockDeferred = yield* Deferred.make<void>()
      // It's important that we resolve the leader election in a blocking way, so there's always a leader.
      // Otherwise mutations could end up being dropped.
      //
      // Sorry for this pun ...
      let gotLocky = yield* WebLock.tryGetDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>(gotLocky ? 'has-lock' : 'no-lock')

      const runLocked = Effect.gen(function* () {
        yield* Effect.logDebug(
          `[@livestore/web:coordinator] ✅ Got lock '${LIVESTORE_TAB_LOCK}' (appHostId: ${appHostId})`,
        )

        yield* Effect.addFinalizer(() =>
          Effect.logDebug(`[@livestore/web:coordinator] Releasing lock for '${LIVESTORE_TAB_LOCK}'`),
        )

        yield* SubscriptionRef.set(lockStatus, 'has-lock')

        const mc = new MessageChannel()

        const worker = tryAsFunctionAndNew(options.worker, { name: `livestore-worker-${schemaKey}` })

        yield* Worker.makeSerialized<WorkerSchema.DedicatedWorkerOuter.Request>({
          initialMessage: () => new WorkerSchema.DedicatedWorkerOuter.InitialMessage({ port: mc.port1 }),
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          UnexpectedError.mapToUnexpectedError,
          Effect.tapErrorCause(shutdown),
          Effect.withSpan('@livestore/web:coordinator:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        yield* shutdownChannel.send(DedicatedWorkerDisconnectBroadcast.make({}))

        const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
        yield* sharedWorker
          .executeEffect(new WorkerSchema.SharedWorker.UpdateMessagePort({ port: mc.port2 }))
          .pipe(UnexpectedError.mapToUnexpectedError, Effect.tapErrorCause(shutdown))

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // console.log('[@livestore/web:coordinator] Shutting down dedicated worker')

            // We first try to gracefully shutdown the dedicated worker and then forcefully terminate it
            yield* Effect.raceFirst(
              sharedWorker
                .executeEffect(new WorkerSchema.DedicatedWorkerInner.Shutdown({}))
                .pipe(Effect.andThen(() => worker.terminate())),

              Effect.sync(() => {
                console.warn('[@livestore/web:coordinator] Worker did not gracefully shutdown in time, terminating it')
                worker.terminate()
              }).pipe(
                // Seems like we still need to wait a bit for the worker to terminate
                // TODO improve this implementation (possibly via another weblock?)
                Effect.delay(1000),
              ),
            )

            // yield* Effect.logDebug('[@livestore/web:coordinator] coordinator shutdown. worker terminated')
          }).pipe(Effect.withSpan('@livestore/web:coordinator:lock:shutdown'), Effect.ignoreLogged),
        )

        yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/web:coordinator:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        yield* Effect.logDebug(
          `[@livestore/web:coordinator] ⏳ Waiting for lock '${LIVESTORE_TAB_LOCK}' (appHostId: ${appHostId})`,
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
      ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Effect.Effect<A, UnexpectedError, R>
        : never =>
        Deferred.await(sharedWorkerDeferred).pipe(
          Effect.flatMap((worker) => worker.executeEffect(req) as any),
          // NOTE we want to treat worker requests as atomic and therefore not allow them to be interrupted
          // Interruption usually only happens during leader re-election or store shutdown
          // Effect.uninterruptible,
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/web:coordinator:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/web:coordinator:runInWorker:${req._tag}`),
          UnexpectedError.mapToUnexpectedError,
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
          return sharedWorker
            .execute(req as any)
            .pipe(
              UnexpectedError.mapToUnexpectedErrorStream,
              Stream.withSpan(`@livestore/web:coordinator:runInWorkerStream:${req._tag}`),
            )
        }).pipe(Stream.unwrap) as any

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({ isConnected: false, timestampMs: Date.now() })

      if (options.syncing !== undefined) {
        yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.NetworkStatusStream()).pipe(
          Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
          Stream.runDrain,
          Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
          Effect.tapErrorCause(shutdown),
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      }

      const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.BootStatusStream()).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapErrorCause(shutdown),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Queue.awaitShutdown(bootStatusQueue).pipe(
        Effect.andThen(Fiber.interrupt(bootStatusFiber)),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const initialSnapshot =
        dataFromFile ?? (yield* runInWorker(new WorkerSchema.DedicatedWorkerInner.GetRecreateSnapshot()))

      const dbPointer = WaSqlite.makeInMemoryDb(sqlite3)
      const syncDb = WaSqlite.makeSynchronousDatabase(sqlite3, dbPointer)

      WaSqlite.importBytesToDb(sqlite3, dbPointer, initialSnapshot)

      // Continously take items from the backlog and execute them in the worker if there are any
      yield* Effect.gen(function* () {
        const items = yield* Queue.takeBetween(executionBacklogQueue, 1, 100).pipe(Effect.map(Chunk.toReadonlyArray))

        yield* runInWorker(new WorkerSchema.DedicatedWorkerInner.ExecuteBulk({ items })).pipe(
          Effect.timeout(10_000),
          Effect.tapErrorCause((cause) =>
            Effect.logDebug('[@livestore/web:coordinator] executeBulkLoop error', cause, items),
          ),
        )

        // NOTE we're waiting a little bit for more items to come in before executing the batch
        yield* Effect.sleep(20)
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.forever,
        UnexpectedError.mapToUnexpectedError,
        Effect.tapErrorCause(shutdown),
        Effect.interruptible,
        Effect.withSpan('@livestore/web:coordinator:executeBulkLoop'),
        Effect.forkScoped,
      )

      const incomingSyncMutationsQueue = yield* Queue.unbounded<MutationEvent.Any>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const mutationEventSchema = makeMutationEventSchema(schema)

      yield* broadcastChannel.listen.pipe(
        Stream.flatten(),
        Stream.filter(({ sender }) => sender === 'leader-worker'),
        Stream.tap(({ mutationEventEncoded }) =>
          Effect.gen(function* () {
            const mutationEventDecoded = yield* Schema.decode(mutationEventSchema)(mutationEventEncoded)
            yield* Queue.offer(incomingSyncMutationsQueue, mutationEventDecoded)
          }),
        ),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (Exit.isFailure(ex) && Exit.isInterrupted(ex) === false) {
            yield* Effect.logError('[@livestore/web:coordinator] coordinator shutdown', ex.cause)
          } else {
            yield* Effect.logWarning('[@livestore/web:coordinator] coordinator shutdown', gotLocky, ex)
          }

          if (gotLocky) {
            yield* Deferred.succeed(lockDeferred, undefined)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.orDie),
      )

      const coordinator = {
        devtools: { enabled: devtoolsEnabled, appHostId },
        lockStatus,
        syncMutations: Stream.fromQueue(incomingSyncMutationsQueue),

        export: runInWorker(new WorkerSchema.DedicatedWorkerInner.Export()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:coordinator:export'),
        ),

        execute: (query, bindValues) =>
          Effect.gen(function* () {
            const currentLockStatus = yield* SubscriptionRef.get(lockStatus)
            if (currentLockStatus === 'has-lock') {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemExecute.make({ query, bindValues }),
              )
            } else {
              console.warn(`[@livestore/web:coordinator] TODO: implement execute without lock`, query, bindValues)
            }
          }),

        mutate: (mutationEventEncoded, { persisted }) =>
          Effect.gen(function* () {
            const currentLockStatus = yield* SubscriptionRef.get(lockStatus)
            if (currentLockStatus === 'has-lock') {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemMutate.make({ mutationEventEncoded, persisted }),
              )
            } else {
              // In case we don't have the lock, we're broadcasting the mutation to the leader worker
              yield* broadcastChannel.send(
                BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'ui-thread', persisted }),
              )
            }
          }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:coordinator:mutate')),

        getMutationLogData: runInWorker(new WorkerSchema.DedicatedWorkerInner.ExportMutationlog()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:coordinator:getMutationLogData'),
        ),

        networkStatus,
      } satisfies Coordinator

      const waitForDevtoolsWebBridgePort = ({ webBridgeId }: { webBridgeId: string }) =>
        Effect.gen(function* () {
          const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
          const { port } = yield* sharedWorker.executeEffect(
            WorkerSchema.SharedWorker.DevtoolsWebBridgeWaitForPort.make({ webBridgeId }),
          )
          return port
        }).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:coordinator:devtools:waitForDevtoolsWebBridgePort'),
        )

      const connectToDevtools = (coordinatorMessagePort: MessagePort) =>
        runInWorkerStream(
          WorkerSchema.DedicatedWorkerInner.ConnectDevtoolsStream.make({
            port: coordinatorMessagePort,
            appHostId,
            isLeaderTab: gotLocky,
          }),
        ).pipe(
          Stream.tap(({ storeMessagePort }) =>
            Effect.gen(function* () {
              const storeDevtoolsChannel = yield* WebChannel.messagePortChannel({
                port: storeMessagePort,
                listenSchema: Devtools.MessageToAppHostStore,
                sendSchema: Devtools.MessageFromAppHostStore,
              })

              yield* connectDevtoolsToStore(storeDevtoolsChannel)
              // NOTE the `forkScoped` seems to be needed here since otherwise interruption doesn't work
            }).pipe(Effect.forkScoped),
          ),
          Stream.runDrain,
          Effect.interruptible,
          Effect.withSpan('@livestore/web:coordinator:devtools:connect'),
        )

      if (devtoolsEnabled) {
        yield* bootDevtools({ coordinator, waitForDevtoolsWebBridgePort, connectToDevtools, key: schema.key })
      }

      return { coordinator, syncDb }
    }).pipe(UnexpectedError.mapToUnexpectedError)

const getAppHostId = (key: string) => {
  // Only use the last 6 characters of the apphost id to make it shorter
  const makeId = () => cuid().slice(-6)

  if (typeof window === 'undefined' || window.sessionStorage === undefined) {
    return makeId()
  }

  const fullKey = `livestore:devtools:appHostId:${key}`
  const storedKey = sessionStorage.getItem(fullKey)

  if (storedKey) return storedKey

  const newKey = makeId()
  sessionStorage.setItem(fullKey, newKey)

  return newKey
}
