import { type Coordinator, type NetworkStatus, type ResetMode, UnexpectedError } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { casesHandled } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import {
  BrowserWorker,
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
  TRef,
  WebLock,
  Worker,
} from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import { makeAdapterFactory } from '../make-adapter-factory.js'
import * as OpfsUtils from '../opfs-utils.js'
import { IDB } from '../utils/idb.js'
import type { MakeCoordinator } from '../utils/types.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
} from './common.js'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA } from './opfs-sah-pool.js'
import * as WorkerSchema from './schema.js'

/** Specifies where to persist data for this coordinator */
export type WebAdapterOptions = {
  worker: Worker | (new (options?: { name: string }) => Worker)
  storage: WorkerSchema.StorageTypeEncoded
  syncing?: WorkerSchema.SyncingType
  /** Can be used to isolate multiple LiveStore apps running in the same origin */
  key?: string
  resetPersistence?: boolean
}

export const makeAdapter = (options: WebAdapterOptions) => makeAdapterFactory(makeCoordinator(options))

const makeCoordinator =
  (options: WebAdapterOptions): MakeCoordinator =>
  ({ schema }) => {
    const manualScope = Effect.runSync(Scope.make())

    return Effect.gen(function* () {
      const executionBacklogQueue = yield* Queue.unbounded<WorkerSchema.ExecutionBacklogItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const lockDeferred = yield* Deferred.make<void>()

      const keySuffix = options.key ? `-${options.key}` : ''

      const LIVESTORE_TAB_LOCK = `livestore-tab-lock${keySuffix}`

      const hasLock = yield* WebLock.tryGetDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK).pipe(
        Effect.withPerformanceMeasure('@livestore/web:waitForLock'),
      )

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      if (options.resetPersistence === true) {
        yield* resetPersistedData(storageOptions, schema.hash, 'all-data')
      }

      // console.log('hasLock', hasLock)

      const broadcastChannel = yield* Effect.succeed(
        new BroadcastChannel(`livestore-sync-${schema.hash}${keySuffix}`),
      ).pipe(Effect.acquireRelease((channel) => Effect.succeed(channel.close())))

      const worker =
        options.worker instanceof globalThis.Worker
          ? options.worker
          : new options.worker({ name: `livestore-worker${keySuffix}` })

      const dataFromFile = yield* getPersistedData(storageOptions, schema.hash)

      const channelId = cuid()

      const workerDeferred = yield* Worker.makePoolSerialized<WorkerSchema.Request>({
        size: 1,
        concurrency: 10,
        initialMessage: () =>
          new WorkerSchema.InitialMessage({
            storageOptions,
            needsRecreate: dataFromFile === undefined,
            hasLock,
            syncOptions: options.syncing,
            key: options.key,
            devtools: { channelId },
          }),
      }).pipe(
        Effect.provide(BrowserWorker.layer(() => worker)),
        Effect.withSpan('@livestore/web:main:setupWorker'),
        Effect.toForkedDeferred,
      )

      const runInWorker = <TReq extends WorkerSchema.Request>(req: TReq) =>
        Deferred.await(workerDeferred).pipe(Effect.andThen((worker) => worker.executeEffect(req)))

      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({ isConnected: false, timestampMs: Date.now() })

      yield* Effect.andThen(Deferred.await(workerDeferred), (worker) =>
        worker.execute(new WorkerSchema.NetworkStatusStream()).pipe(
          Stream.tap((_) => SubscriptionRef.set(networkStatus, _)),
          Stream.runDrain,
          Effect.tapCauseLogPretty,
        ),
      ).pipe(Effect.forkDaemon)

      const initialSnapshot =
        dataFromFile ??
        (yield* runInWorker(new WorkerSchema.GetRecreateSnapshot()).pipe(Effect.withSpan('initialSnapshot')))

      // Continously take items from the backlog and execute them in the worker if there are any
      yield* Deferred.await(workerDeferred).pipe(
        Effect.andThen(() =>
          Queue.takeBetween(executionBacklogQueue, 1, 100).pipe(
            Effect.tap((items) =>
              runInWorker(new WorkerSchema.ExecuteBulk({ items: Chunk.toReadonlyArray(items) })).pipe(
                Effect.withSpan('executeBulk'),
              ),
            ),
            // NOTE we're waiting a little bit for more items to come in before executing the batch
            Effect.tap(() => Effect.sleep(20)),
            Effect.forever,
            Effect.interruptible,
          ),
        ),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const hasLockTRef = yield* TRef.make(hasLock)

      const incomingSyncMutationsQueue = yield* Queue.unbounded<MutationEvent.Any>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const mutationEventSchema = makeMutationEventSchema(schema)

      broadcastChannel.addEventListener('message', (event) => {
        const decodedEvent = Schema.decodeUnknownOption(BCMessage.Message)(event.data)
        if (decodedEvent._tag === 'Some') {
          const { sender, mutationEventEncoded } = decodedEvent.value
          if (sender === 'leader-worker') {
            const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)
            Queue.offer(incomingSyncMutationsQueue, mutationEventDecoded).pipe(Effect.tapCauseLogPretty, Effect.runSync)
            // this.mutate({ wasSyncMessage: true }, mutationEventDecoded as any)
          }
        }
      })

      const shutdownWorker = Effect.race(
        // In case the graceful shutdown didn't finish in time, we terminate the worker
        runInWorker(new WorkerSchema.Shutdown({})).pipe(Effect.andThen(() => worker.terminate())),
        Effect.sync(() => {
          console.warn('[livestore] Worker did not gracefully shutdown in time, terminating it')
          worker.terminate()
        }).pipe(
          // Seems like we still need to wait a bit for the worker to terminate
          // TODO improve this implementation (possibly via another weblock?)
          Effect.delay(1000),
        ),
      )

      const coordinator = {
        devtools: { channelId },
        hasLock: hasLockTRef,
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

        export: runInWorker(new WorkerSchema.Export()).pipe(
          Effect.withSpan('@livestore/web:main:export'),
          Effect.mapError((error) => new UnexpectedError({ error })),
        ),

        dangerouslyReset: (mode) =>
          Effect.gen(function* () {
            yield* shutdownWorker

            yield* resetPersistedData(storageOptions, schema.hash, mode)
          }).pipe(Effect.mapError((error) => new UnexpectedError({ error }))),

        execute: (query, bindValues) =>
          Effect.gen(function* () {
            if (hasLock) {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemExecute.make({ query, bindValues }),
              )
            } else {
              console.warn(`TODO: implement execute without lock`, query, bindValues)
            }
          }),

        mutate: (mutationEventEncoded, { persisted }) =>
          Effect.gen(function* () {
            if (hasLock) {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemMutate.make({ mutationEventEncoded, persisted }),
              )
            } else {
              broadcastChannel.postMessage(
                Schema.encodeSync(BCMessage.Message)(
                  BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'ui-thread', persisted }),
                ),
              )
            }
          }),

        getMutationLogData: runInWorker(new WorkerSchema.ExportMutationlog()).pipe(
          Effect.timeout(10_000),
          Effect.mapError((error) => new UnexpectedError({ error })),
        ),

        shutdown: Effect.gen(function* () {
          yield* shutdownWorker

          yield* Deferred.succeed(lockDeferred, undefined)

          yield* Scope.close(manualScope, Exit.interrupt(FiberId.none))
        }).pipe(Effect.mapError((error) => new UnexpectedError({ error }))),

        networkStatus,
      } satisfies Coordinator

      return coordinator
    }).pipe(Scope.extend(manualScope), Effect.orDie, Effect.scoped)
  }

const getPersistedData = (storage: WorkerSchema.StorageType, schemaHash: number) =>
  Effect.promise(async () => {
    try {
      performance.mark('@livestore/web:getPersistedData:start')
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

          const getAllFiles = async (
            asyncIterator: AsyncIterable<FileSystemHandle>,
          ): Promise<FileSystemFileHandle[]> => {
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
    } finally {
      performance.mark('@livestore/web:getPersistedData:end')
      performance.measure(
        '@livestore/web:getPersistedData',
        '@livestore/web:getPersistedData:start',
        '@livestore/web:getPersistedData:end',
      )
    }
  }).pipe(Effect.withSpan('@livestore/web:getPersistedData'))

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
