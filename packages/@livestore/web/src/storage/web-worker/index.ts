import type { StorageDatabase } from '@livestore/common'
import { makeSchemaHash } from '@livestore/common/schema'
import { casesHandled, omit } from '@livestore/utils'
import type { Duration } from '@livestore/utils/effect'
import { BrowserWorker, Deferred, Effect, Exit, FiberId, Queue, Scope, WebLock, Worker } from '@livestore/utils/effect'

import { IDB } from '../utils/idb.js'
import type { StorageInit } from '../utils/types.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
  getOpfsDirHandle,
} from './common.js'
import * as WorkerSchema from './schema.js'

export type StorageOptionsWeb = {
  /** Specifies where to persist data for this storage */
  worker: Worker | (new (options?: { name: string }) => Worker)
} & WorkerSchema.StorageType

export const WebWorkerStorage = {
  load: (options: StorageOptionsWeb): StorageInit => createStorage(options),
}

const LIVESTORE_TAB_LOCK = 'livestore-tab-lock'

export const createStorage =
  (options: StorageOptionsWeb): StorageInit =>
  ({ otel: {}, schema }) => {
    const manualScope = Effect.runSync(Scope.make())

    return Effect.gen(function* ($) {
      const executionBacklogQueue = yield* $(
        Queue.unbounded<WorkerSchema.ExecutionBacklogItem>(),
        Effect.acquireRelease(Queue.shutdown),
      )

      const lockDeferred = yield* $(Deferred.make<void>())

      const worker =
        options.worker instanceof globalThis.Worker ? options.worker : new options.worker({ name: 'livestore-worker' })

      const storageOptions = omit(options, ['worker'])

      const workerDeferred = yield* $(
        Worker.makePoolSerialized<WorkerSchema.Request>({
          size: 1,
          permits: 10,
          initialMessage: () => new WorkerSchema.InitialMessage({ storage: storageOptions }),
        }).pipe(Effect.provide(BrowserWorker.layer(() => worker)), Effect.toForkedDeferred),
      )

      const runInWorker = <TReq extends WorkerSchema.Request>(req: TReq) =>
        Effect.andThen(Deferred.await(workerDeferred), (worker) => worker.executeEffect(req))

      yield* $(
        Deferred.await(workerDeferred),
        Effect.andThen(() =>
          queueTakeTimeout(executionBacklogQueue, 100, 100).pipe(
            Effect.tap((items) => runInWorker(new WorkerSchema.ExecuteBulk({ items }))),
            Effect.forever,
            Effect.interruptible,
          ),
        ),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const schemaHash = makeSchemaHash(schema)

      const storage = {
        getInitialSnapshot: () =>
          Effect.gen(function* ($) {
            // TODO replace with a proper multi-tab syncing/lock-transfer mechanism
            yield* $(
              WebLock.waitForDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK),
              Effect.withPerformanceMeasure('@livestore/web:waitForLock'),
            )

            // NOTE here we're trying to access the persisted data directly from the main thread which
            // ususally speeds up the init process as we don't have to wait for the worker to be ready
            // This will only work for the first tab though
            const dataFromFile = yield* $(Effect.promise(() => getPersistedData(storageOptions, schemaHash)))
            if (dataFromFile !== undefined) return dataFromFile

            return yield* $(runInWorker(new WorkerSchema.Setup()))
          }).pipe(Effect.withPerformanceMeasure('@livestore/web:getInitialSnapshot'), Effect.runPromise),

        export: () => runInWorker(new WorkerSchema.Export()).pipe(Effect.runPromise),

        dangerouslyReset: () =>
          Effect.gen(function* ($) {
            yield* $(runInWorker(new WorkerSchema.Shutdown({})))

            yield* $(Effect.promise(() => resetPersistedData(storageOptions, schemaHash)))
          }).pipe(Effect.runPromise),

        execute: async (query, bindValues) => {
          await Queue.offer(executionBacklogQueue, { _tag: 'execute', query, bindValues }).pipe(Effect.runPromise)
        },

        mutate: async (mutationEventEncoded) => {
          await Queue.offer(executionBacklogQueue, { _tag: 'mutate', mutationEventEncoded }).pipe(Effect.runPromise)
        },

        getMutationLogData: () => runInWorker(new WorkerSchema.ExportMutationlog()).pipe(Effect.runPromise),

        shutdown: () =>
          Effect.gen(function* ($) {
            yield* $(
              runInWorker(new WorkerSchema.Shutdown({})).pipe(Effect.andThen(() => worker.terminate())),
              // In case the graceful shutdown didn't finish in time, we terminate the worker
              Effect.race(
                Effect.sync(() => {
                  console.warn('[livestore] Worker did not gracefully shutdown in time, terminating it')
                  worker.terminate()
                }).pipe(Effect.delay(1000)),
              ),
            )

            yield* $(Deferred.succeed(lockDeferred, undefined))

            yield* $(Scope.close(manualScope, Exit.interrupt(FiberId.none)))
          }).pipe(Effect.runPromise),
      } satisfies StorageDatabase

      return storage
    }).pipe(Scope.extend(manualScope), Effect.runPromise)
  }

const getPersistedData = async (storage: WorkerSchema.StorageType, schemaHash: number) => {
  try {
    performance.mark('@livestore/web:getPersistedData:start')
    switch (storage.type) {
      case 'opfs': {
        try {
          const dirHandle = await getOpfsDirHandle(storage.directory)
          const fileHandle = await dirHandle.getFileHandle(getAppDbFileName(storage.filePrefix, schemaHash))
          const file = await fileHandle.getFile()
          const buffer = await file.arrayBuffer()
          const data = new Uint8Array(buffer)

          return data
        } catch (error: any) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            return undefined
          }

          throw error
        }
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
}

const resetPersistedData = async (storage: WorkerSchema.StorageType, schemaHash: number) => {
  switch (storage.type) {
    case 'opfs': {
      const dirHandle = await getOpfsDirHandle(storage.directory)
      await dirHandle.removeEntry(getAppDbFileName(storage.filePrefix, schemaHash))
      await dirHandle.removeEntry(getMutationlogDbFileName(storage.filePrefix))
      break
    }

    case 'indexeddb': {
      const idbApp = new IDB(
        storage.databaseName ?? 'livestore',
        getAppDbIdbStoreName(storage.storeNamePrefix, schemaHash),
      )
      await idbApp.deleteDb()

      const idbMutationLog = new IDB(
        storage.databaseName ?? 'livestore',
        getMutationlogDbIdbStoreName(storage.storeNamePrefix),
      )
      await idbMutationLog.deleteDb()

      break
    }
    default: {
      casesHandled(storage)
    }
  }
}

const queueTakeTimeout = <A>(queue: Queue.Queue<A>, upToItems: number, timeout: Duration.DurationInput) =>
  Effect.gen(function* ($) {
    const itemsFromFirstTake = yield* $(Queue.takeUpTo(queue, upToItems))
    if (itemsFromFirstTake.length === upToItems) return [...itemsFromFirstTake]

    const missingItems = upToItems - itemsFromFirstTake.length

    yield* $(Effect.sleep(timeout))

    const itemsFromSecondTake = yield* $(Queue.takeUpTo(queue, missingItems))

    return [...itemsFromFirstTake, ...itemsFromSecondTake]
  })
