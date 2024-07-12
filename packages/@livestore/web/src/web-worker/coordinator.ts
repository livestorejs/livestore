import type { Coordinator, LockStatus, NetworkStatus, ResetMode } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
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
  Exit,
  FiberId,
  Queue,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  WebLock,
  Worker,
} from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import * as OpfsUtils from '../opfs-utils.js'
import { IDB } from '../utils/idb.js'
import type { MakeCoordinator } from '../utils/types.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
} from './common.js'
import LiveStoreSharedWorker from './make-shared-worker.js?sharedworker'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA } from './opfs-sah-pool.js'
import * as WorkerSchema from './schema.js'

/** Specifies where to persist data for this coordinator */
export type WebAdapterOptions = {
  worker: globalThis.Worker | (new (options?: { name: string }) => globalThis.Worker)
  storage: WorkerSchema.StorageTypeEncoded
  syncing?: WorkerSchema.SyncingType
  /** Can be used to isolate multiple LiveStore apps running in the same origin */
  key?: string
  resetPersistence?: boolean
}

export const makeCoordinator =
  (options: WebAdapterOptions): MakeCoordinator =>
  ({ schema, devtoolsEnabled }) => {
    const manualScope = Effect.runSync(Scope.make())

    return Effect.gen(function* () {
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
        Effect.provide(
          BrowserWorker.layer(() => new LiveStoreSharedWorker({ name: `livestore-shared-worker${keySuffix}` })),
        ),
        Effect.tapErrorCause((cause) => Scope.close(manualScope, Exit.fail(cause))),
        Effect.withSpan('@livestore/web:main:setupSharedWorker'),
        Effect.toForkedDeferred,
      )

      const lockDeferred = yield* Deferred.make<void>()
      // It's important that we resolve the leader election in a blocking way, so there's always a leader.
      // Otherwise mutations could end up being dropped.
      //
      // Sorry for this pun ...
      const gotLocky = yield* WebLock.tryGetDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>(gotLocky ? 'has-lock' : 'no-lock')

      const runLocked = Effect.gen(function* () {
        console.debug(`[@livestore/web:coordinator] Got lock for '${LIVESTORE_TAB_LOCK}'`)

        yield* SubscriptionRef.set(lockStatus, 'has-lock')

        const mc = new MessageChannel()

        // TODO handle shutdown
        const worker =
          options.worker instanceof globalThis.Worker
            ? options.worker
            : new options.worker({ name: `livestore-worker${keySuffix}` })

        yield* Worker.makePoolSerialized<WorkerSchema.DedicatedWorkerOuter.Request>({
          size: 1,
          concurrency: 1,
          initialMessage: () => new WorkerSchema.DedicatedWorkerOuter.InitialMessage({ port: mc.port1 }),
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          Effect.tapErrorCause((cause) => Scope.close(manualScope, Exit.fail(cause))),
          Effect.withSpan('@livestore/web:main:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        const sharedWorker = yield* Deferred.await(sharedWorkerDeferred)
        yield* sharedWorker.executeEffect(new WorkerSchema.SharedWorker.UpdateMessagePort({ port: mc.port2 }))

        yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/web:main:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        // TODO find a cleaner implementation for the lock handling as we don't make use of the deferred properly right now
        const innerLockDeferred = yield* Deferred.make<void>()
        yield* WebLock.waitForDeferredLock(innerLockDeferred, LIVESTORE_TAB_LOCK).pipe(
          Effect.andThen(() => runLocked),
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
          Effect.logWarnIfTakesLongerThan({ label: `@livestore/web:main:runInWorker:${req._tag}`, duration: 2000 }),
          Effect.timeout(10_000),
          Effect.withSpan(`@livestore/web:main:runInWorker:${req._tag}`),
          Effect.mapError((cause) => new UnexpectedError({ cause })),
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.SharedWorker.Request.Type>(
        req: TReq,
      ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const worker = yield* Deferred.await(sharedWorkerDeferred)
          return worker.execute(req).pipe(
            Stream.mapError((cause) => new UnexpectedError({ cause })),
            Stream.withSpan(`@livestore/web:main:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({ isConnected: false, timestampMs: Date.now() })

      // TODO repeat when interrupted
      yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.NetworkStatusStream()).pipe(
        Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* runInWorkerStream(new WorkerSchema.DedicatedWorkerInner.ListenForReloadStream()).pipe(
        Stream.tapSync((_) => window.location.reload()),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const initialSnapshot =
        dataFromFile ?? (yield* runInWorker(new WorkerSchema.DedicatedWorkerInner.GetRecreateSnapshot()))

      // Continously take items from the backlog and execute them in the worker if there are any
      yield* Effect.gen(function* () {
        const items = yield* Queue.takeBetween(executionBacklogQueue, 1, 100)

        yield* runInWorker(new WorkerSchema.DedicatedWorkerInner.ExecuteBulk({ items: Chunk.toReadonlyArray(items) }))

        // NOTE we're waiting a little bit for more items to come in before executing the batch
        yield* Effect.sleep(20)
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.forever,
        Effect.withSpan('@livestore/web:main:executeBulkLoop'),
        Effect.forkScoped,
      )

      const incomingSyncMutationsQueue = yield* Queue.unbounded<MutationEvent.Any>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      yield* Effect.addFinalizer((ex) => {
        isShutdownRef.current = true
        return Effect.logWarning(
          '[@livestore/web:coordinator] coordinator shutdown',
          ex._tag === 'Failure' ? Cause.pretty(ex.cause) : ex,
        )
      })

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
          Effect.withSpan('@livestore/web:main:broadcastChannel:onmessage'),
          Effect.tapCauseLogPretty,
          Effect.runFork,
        ),
      )

      // TODO in case this coordinator holds the dedicated worker, handle shutdown properly
      const shutdownWorker = Effect.race(
        // In case the graceful shutdown didn't finish in time, we terminate the worker
        runInWorker(new WorkerSchema.DedicatedWorkerInner.Shutdown({})),
        // runInWorker(new WorkerSchema.DedicatedWorkerInner.Shutdown({})).pipe(Effect.andThen(() => worker.terminate())),
        Effect.sync(() => {
          console.warn('[@livestore/web:coordinator] Worker did not gracefully shutdown in time, terminating it')
          // worker.terminate()
        }).pipe(
          // Seems like we still need to wait a bit for the worker to terminate
          // TODO improve this implementation (possibly via another weblock?)
          Effect.delay(1000),
        ),
      )

      const coordinator = {
        isShutdownRef,
        devtools: {
          enabled: devtoolsEnabled,
          channelId,
          connect: ({ connectionId, port }) =>
            runInWorker(new WorkerSchema.DedicatedWorkerInner.InitDevtools({ port })),
        },
        lockStatus,
        syncMutations: Stream.fromQueue(incomingSyncMutationsQueue),
        getInitialSnapshot: Effect.sync(() => initialSnapshot),
        // Effect.gen(function* () {
        //   // TODO replace with a proper multi-tab syncing/lock-transfer mechanism
        //   // yield* pipe(
        //   //   WebLock.waitForDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK),
        //   //   Effect.withPerformanceMeasure('@livestore/web:waitForLock'),
        //   //   Effect.tapSync(() => {
        //   //     hasLock = true
        //   //   }),
        //   //   Effect.tapCauseLogPretty,
        //   //   Effect.fork,
        //   // )

        //   // NOTE here we're trying to access the persisted data directly from the main thread which
        //   // ususally speeds up the init process as we don't have to wait for the worker to be ready
        //   // This will only work for the first tab though

        //   return yield* runInWorker(new WorkerSchema.Setup())
        // }).pipe(
        //   Effect.withPerformanceMeasure('@livestore/web:getInitialSnapshot'),
        //   Effect.tapCauseLogPretty,
        //   Effect.runPromise,
        // ),

        export: runInWorker(new WorkerSchema.DedicatedWorkerInner.Export()),

        dangerouslyReset: (mode) =>
          Effect.gen(function* () {
            yield* shutdownWorker

            // TODO refactor to make use of persisted-sql destory functionality
            yield* resetPersistedData(storageOptions, schema.hash, mode)
          }).pipe(Effect.mapError((cause) => new UnexpectedError({ cause }))),

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

        getMutationLogData: runInWorker(new WorkerSchema.DedicatedWorkerInner.ExportMutationlog()),

        shutdown: Effect.gen(function* () {
          // TODO in case this coordinator holds the dedicated worker, handle shutdown properly
          yield* shutdownWorker

          yield* Deferred.succeed(lockDeferred, undefined)

          yield* Scope.close(manualScope, Exit.interrupt(FiberId.none))
        }).pipe(Effect.mapError((cause) => new UnexpectedError({ cause }))),

        networkStatus,
      } satisfies Coordinator

      return coordinator
    }).pipe(Scope.extend(manualScope), Effect.orDie, Effect.scoped)
  }

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
