import type { Coordinator, LockStatus, NetworkStatus, ResetMode, UnexpectedError } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { casesHandled, ref } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import type { Serializable } from '@livestore/utils/effect'
import {
  BrowserWorker,
  Cause,
  Chunk,
  Deferred,
  Effect,
  Queue,
  Runtime,
  Schema,
  Stream,
  SubscriptionRef,
  WebLock,
  Worker,
} from '@livestore/utils/effect'

// TODO bring back - this currently doesn't work due to https://github.com/vitejs/vite/issues/8427
// NOTE We're using a non-relative import here for Vite to properly resolve the import during app builds
// import LiveStoreSharedWorker from '@livestore/web/internal-shared-worker?sharedworker'
import { BCMessage } from '../common/index.js'
import * as OpfsUtils from '../opfs-utils.js'
import { IDB } from '../utils/idb.js'
import type { MakeCoordinator } from '../utils/types.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
  mapToUnexpectedError,
  mapToUnexpectedErrorStream,
} from './common.js'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA } from './opfs-sah-pool.js'
import * as WorkerSchema from './schema.js'

export type WebAdapterOptions = {
  worker: globalThis.Worker | (new (options?: { name: string }) => globalThis.Worker)
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
  sharedWorker: globalThis.SharedWorker | (new (options?: { name: string }) => globalThis.SharedWorker)
  /** Specifies where to persist data for this adapter */
  storage: WorkerSchema.StorageTypeEncoded
  syncing?: WorkerSchema.SyncingType
  /** Can be used to isolate multiple LiveStore apps running in the same origin */
  key?: string
  resetPersistence?: boolean
}

export const makeCoordinator =
  (options: WebAdapterOptions): MakeCoordinator =>
  ({ schema, devtoolsEnabled, bootStatusQueue, shutdown }) =>
    Effect.gen(function* () {
      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const executionBacklogQueue = yield* Queue.unbounded<WorkerSchema.ExecutionBacklogItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const keySuffix = options.key ? `-${options.key}` : ''

      const LIVESTORE_TAB_LOCK = `livestore-tab-lock${keySuffix}`

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      const isShutdownRef = ref(false)

      if (options.resetPersistence === true) {
        // TODO refactor to make use of persisted-sql destory functionality
        yield* resetPersistedData(storageOptions, schema.hash, 'all-data')
      }

      const broadcastChannel = yield* Effect.succeed(
        new BroadcastChannel(`livestore-sync-${schema.hash}${keySuffix}`),
      ).pipe(Effect.acquireRelease((channel) => Effect.succeed(channel.close())))

      // TODO also verify persisted data
      const dataFromFile = yield* getPersistedData(storageOptions, schema.hash)

      const channelId = cuid()

      const sharedWorker =
        options.sharedWorker instanceof globalThis.SharedWorker
          ? options.sharedWorker
          : new options.sharedWorker({ name: `livestore-shared-worker${keySuffix}` })

      const sharedWorkerDeferred = yield* Worker.makePoolSerialized<typeof WorkerSchema.SharedWorker.Request.Type>({
        size: 1,
        concurrency: 100,
        initialMessage: () =>
          new WorkerSchema.DedicatedWorkerInner.InitialMessage({
            storageOptions,
            needsRecreate: dataFromFile === undefined,
            syncOptions: options.syncing,
            key: options.key,
            devtools: { channelId, enabled: devtoolsEnabled },
          }),
      }).pipe(
        Effect.provide(BrowserWorker.layer(() => sharedWorker)),
        Effect.tapErrorCause((cause) => shutdown(cause)),
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
        yield* Effect.logDebug(`[@livestore/web:coordinator] Got lock for '${LIVESTORE_TAB_LOCK}'`)

        yield* Effect.addFinalizer(() =>
          Effect.logDebug(`[@livestore/web:coordinator] Releasing lock for '${LIVESTORE_TAB_LOCK}'`),
        )

        yield* SubscriptionRef.set(lockStatus, 'has-lock')

        const mc = new MessageChannel()

        // TODO handle shutdown
        const worker =
          options.worker instanceof globalThis.Worker
            ? options.worker
            : new options.worker({ name: `livestore-worker${keySuffix}` })

        yield* Worker.makeSerialized<WorkerSchema.DedicatedWorkerOuter.Request>({
          initialMessage: () => new WorkerSchema.DedicatedWorkerOuter.InitialMessage({ port: mc.port1 }),
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          Effect.tapErrorCause((cause) => shutdown(cause)),
          Effect.withSpan('@livestore/web:coordinator:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
        yield* sharedWorker.executeEffect(new WorkerSchema.SharedWorker.UpdateMessagePort({ port: mc.port2 }))

        yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/web:coordinator:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        // TODO find a cleaner implementation for the lock handling as we don't make use of the deferred properly right now
        const innerLockDeferred = yield* Deferred.make<void>()
        yield* WebLock.waitForDeferredLock(innerLockDeferred, LIVESTORE_TAB_LOCK).pipe(
          Effect.andThen(() => {
            gotLocky = true
            return runLocked
          }),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      } else {
        yield* runLocked.pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const runInWorker = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Effect.Effect<A, UnexpectedError, R>
        : never =>
        Deferred.await(sharedWorkerDeferred).pipe(
          Effect.flatMap((worker) => worker.executeEffect(req)),
          // NOTE we want to treat worker requests as atomic and therefore not allow them to be interrupted
          // Interruption usually only happens during leader re-election or store shutdown
          Effect.uninterruptible,
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/web:coordinator:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/web:coordinator:runInWorker:${req._tag}`),
          mapToUnexpectedError,
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
          return sharedWorker
            .execute(req)
            .pipe(
              mapToUnexpectedErrorStream,
              Stream.withSpan(`@livestore/web:coordinator:runInWorkerStream:${req._tag}`),
            )
        }).pipe(Stream.unwrap) as any

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({ isConnected: false, timestampMs: Date.now() })

      if (options.syncing !== undefined) {
        yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.NetworkStatusStream()).pipe(
          Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
          Stream.runDrain,
          Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      }

      yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.ListenForReloadStream()).pipe(
        Stream.tapSync((_) => window.location.reload()),
        Stream.runDrain,
        Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      // TODO Make sure boot status events already stream in during snapshot recreation and not after
      // See https://share.cleanshot.com/7VprVPzL + https://share.cleanshot.com/NZvJwYFY
      // Will need session with Mike A. / Tim Smart
      yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.BootStatusStream()).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const initialSnapshot =
        dataFromFile ?? (yield* runInWorker(new WorkerSchema.DedicatedWorkerInner.GetRecreateSnapshot()))

      // Continously take items from the backlog and execute them in the worker if there are any
      yield* Effect.gen(function* () {
        const items = yield* Queue.takeBetween(executionBacklogQueue, 1, 100)

        yield* runInWorker(
          new WorkerSchema.DedicatedWorkerInner.ExecuteBulk({ items: Chunk.toReadonlyArray(items) }),
        ).pipe(Effect.timeout(10_000))

        // NOTE we're waiting a little bit for more items to come in before executing the batch
        yield* Effect.sleep(20)
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.forever,
        Effect.withSpan('@livestore/web:coordinator:executeBulkLoop'),
        Effect.forkScoped,
      )

      const incomingSyncMutationsQueue = yield* Queue.unbounded<MutationEvent.Any>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const runtime = yield* Effect.runtime<never>()

      const mutationEventSchema = makeMutationEventSchema(schema)

      broadcastChannel.addEventListener('message', (event) =>
        Effect.gen(function* () {
          const decodedEvent = yield* Schema.decodeUnknown(BCMessage.Message)(event.data)
          // console.log('[@livestore/web:coordinator] broadcastChannel message', decodedEvent)
          const { sender, mutationEventEncoded } = decodedEvent
          if (sender === 'leader-worker') {
            const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)
            yield* Queue.offer(incomingSyncMutationsQueue, mutationEventDecoded).pipe(ensureQueueSuccess)
          }
        }).pipe(
          Effect.withSpan('@livestore/web:coordinator:broadcastChannel:onmessage'),
          Effect.tapCauseLogPretty,
          Runtime.runFork(runtime),
        ),
      )

      // TODO in case this coordinator holds the dedicated worker, handle shutdown properly
      const shutdownWorker = Effect.race(
        // In case the graceful shutdown didn't finish in time, we terminate the worker
        runInWorker(new WorkerSchema.DedicatedWorkerInner.Shutdown({})).pipe(Effect.timeout(2000)),
        // runInWorker(new WorkerSchema.DedicatedWorkerInner.Shutdown({})).pipe(Effect.andThen(() => worker.terminate())),
        Effect.void,
        // Effect.sync(() => {
        //   console.warn('[@livestore/web:coordinator] Worker did not gracefully shutdown in time, terminating it')
        //   // worker.terminate()
        // }).pipe(
        //   // Seems like we still need to wait a bit for the worker to terminate
        //   // TODO improve this implementation (possibly via another weblock?)
        //   Effect.delay(1000),
        // ),
      )

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          isShutdownRef.current = true

          if (gotLocky) {
            yield* shutdownWorker

            yield* Deferred.succeed(lockDeferred, undefined)
          }

          yield* Effect.logWarning(
            '[@livestore/web:coordinator] coordinator shutdown',
            ex._tag === 'Failure' ? Cause.pretty(ex.cause) : ex,
          )
        }).pipe(Effect.orDie),
      )

      const coordinator = {
        isShutdownRef,
        devtools: {
          enabled: devtoolsEnabled,
          channelId,
          connect: ({ connectionId, port }) =>
            runInWorker(
              new WorkerSchema.DedicatedWorkerInner.ConnectDevtools({ port, connectionId, isLeaderTab: gotLocky }),
            ).pipe(Effect.timeout(10_000), mapToUnexpectedError, Effect.withSpan('@livestore/web:coordinator:connect')),
        },
        lockStatus,
        syncMutations: Stream.fromQueue(incomingSyncMutationsQueue),
        getInitialSnapshot: Effect.sync(() => initialSnapshot),

        export: runInWorker(new WorkerSchema.DedicatedWorkerInner.Export()).pipe(
          Effect.timeout(10_000),
          mapToUnexpectedError,
          Effect.withSpan('@livestore/web:coordinator:export'),
        ),

        dangerouslyReset: (mode) =>
          Effect.gen(function* () {
            yield* shutdownWorker

            // TODO refactor to make use of persisted-sql destory functionality
            yield* resetPersistedData(storageOptions, schema.hash, mode)
          }).pipe(mapToUnexpectedError),

        execute: (query, bindValues) =>
          Effect.gen(function* () {
            const currentLockStatus = yield* SubscriptionRef.get(lockStatus)
            if (currentLockStatus === 'has-lock') {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemExecute.make({ query, bindValues }),
              ).pipe(ensureQueueSuccess)
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
              ).pipe(ensureQueueSuccess)
            } else {
              broadcastChannel.postMessage(
                Schema.encodeSync(BCMessage.Message)(
                  BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'ui-thread', persisted }),
                ),
              )
            }
          }).pipe(Effect.withSpan('@livestore/web:coordinator:mutate')),

        getMutationLogData: runInWorker(new WorkerSchema.DedicatedWorkerInner.ExportMutationlog()).pipe(
          Effect.timeout(10_000),
          mapToUnexpectedError,
          Effect.withSpan('@livestore/web:coordinator:getMutationLogData'),
        ),

        networkStatus,
      } satisfies Coordinator

      return coordinator
    }).pipe(mapToUnexpectedError)

const getPersistedData = (storage: WorkerSchema.StorageType, schemaHash: number) =>
  Effect.promise(async () => {
    switch (storage.type) {
      case 'opfs': {
        try {
          const dirHandle = await OpfsUtils.getDirHandle(storage.directory)
          const fileHandle = await dirHandle.getFileHandle(getAppDbFileName(storage.filePrefix, schemaHash))
          const file = await fileHandle.getFile()
          const buffer = await file.arrayBuffer()
          const data = new Uint8Array(buffer)

          // In rare cases the file might be created by the `.Setup` flow but wasn't finished.
          // This early causes the `.Setup` flow to run again.
          // TODO we probably want to run the `.Setup` flow atomically so there's never a non-compliant file
          if (data.length === 0) return undefined

          return data
        } catch (error: any) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            return undefined
          }

          throw error
        }
      }

      case 'opfs-sahpool-experimental': {
        const sahPoolOpaqueDir = await OpfsUtils.getDirHandle(`${storage.directory}/.opaque`).catch(() => undefined)

        if (sahPoolOpaqueDir === undefined) {
          return undefined
        }

        const tryGetDbFile = async (fileHandle: FileSystemFileHandle) => {
          const file = await fileHandle.getFile()
          const fileName = await decodeSAHPoolFilename(file)
          return fileName ? { fileName, file } : undefined
        }

        const getAllFiles = async (asyncIterator: AsyncIterable<FileSystemHandle>): Promise<FileSystemFileHandle[]> => {
          const results: FileSystemFileHandle[] = []
          for await (const value of asyncIterator) {
            if (value.kind === 'file') {
              results.push(value as FileSystemFileHandle)
            }
          }
          return results
        }

        const files = await getAllFiles(sahPoolOpaqueDir.values())

        const fileResults = await Promise.all(files.map(tryGetDbFile))

        const appDbFileName = '/' + getAppDbFileName(storage.filePrefix, schemaHash)

        const dbFileRes = fileResults.find((_) => _?.fileName === appDbFileName)

        if (dbFileRes !== undefined) {
          const data = await dbFileRes.file.slice(HEADER_OFFSET_DATA).arrayBuffer()

          return new Uint8Array(data)
        }

        return undefined
      }

      case 'indexeddb': {
        const idb = new IDB(
          storage.databaseName ?? 'livestore',
          getAppDbIdbStoreName(storage.storeNamePrefix, schemaHash),
        )

        return await idb.get('db')
      }
      default: {
        casesHandled(storage)
      }
    }
  }).pipe(
    Effect.logWarnIfTakesLongerThan({ duration: 1000, label: '@livestore/web:getPersistedData' }),
    Effect.withPerformanceMeasure('@livestore/web:getPersistedData'),
    Effect.withSpan('@livestore/web:getPersistedData'),
  )

// TODO refactor to make use of persisted-sql destory functionality
const resetPersistedData = (storage: WorkerSchema.StorageType, schemaHash: number, resetMode: ResetMode) =>
  Effect.promise(async () => {
    switch (storage.type) {
      case 'opfs': {
        const dirHandle = await OpfsUtils.getDirHandle(storage.directory)
        await dirHandle.removeEntry(getAppDbFileName(storage.filePrefix, schemaHash))
        if (resetMode === 'all-data') {
          await dirHandle.removeEntry(getMutationlogDbFileName(storage.filePrefix))
        }
        break
      }

      case 'opfs-sahpool-experimental': {
        const rootHandle = await OpfsUtils.rootHandlePromise
        await rootHandle.removeEntry(storage.directory, { recursive: true })

        break
      }

      case 'indexeddb': {
        const idbApp = new IDB(
          storage.databaseName ?? 'livestore',
          getAppDbIdbStoreName(storage.storeNamePrefix, schemaHash),
        )
        await idbApp.deleteDb()

        if (resetMode === 'all-data') {
          const idbMutationLog = new IDB(
            storage.databaseName ?? 'livestore',
            getMutationlogDbIdbStoreName(storage.storeNamePrefix),
          )
          await idbMutationLog.deleteDb()
        }

        break
      }

      default: {
        casesHandled(storage)
      }
    }
  }).pipe(Effect.withSpan('@livestore/web:resetPersistedData'))

const ensureQueueSuccess = <E, R>(effect: Effect.Effect<boolean, E, R>) =>
  effect.pipe(Effect.tap((wasQueued) => (wasQueued ? Effect.void : Effect.dieMessage('Mutation queue failed'))))
