import type { ResetMode, StorageDatabase } from '@livestore/common'
import { makeSchemaHash } from '@livestore/common/schema'
import { casesHandled, omit } from '@livestore/utils'
import {
  BrowserWorker,
  Chunk,
  Deferred,
  Effect,
  Exit,
  FiberId,
  pipe,
  Queue,
  Scope,
  WebLock,
  Worker,
} from '@livestore/utils/effect'

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

/** Specifies where to persist data for this storage */
export type StorageOptionsWeb = {
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

    return Effect.gen(function* () {
      const executionBacklogQueue = yield* Queue.unbounded<WorkerSchema.ExecutionBacklogItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const lockDeferred = yield* pipe(Deferred.make<void>())

      const worker =
        options.worker instanceof globalThis.Worker ? options.worker : new options.worker({ name: 'livestore-worker' })

      const storageOptions = omit(options, ['worker'])

      const workerDeferred = yield* pipe(
        Worker.makePoolSerialized<WorkerSchema.Request>({
          size: 1,
          permits: 10,
          initialMessage: () => new WorkerSchema.InitialMessage({ storageOptions }),
        }).pipe(Effect.provide(BrowserWorker.layer(() => worker)), Effect.toForkedDeferred),
      )

      const runInWorker = <TReq extends WorkerSchema.Request>(req: TReq) =>
        Effect.andThen(Deferred.await(workerDeferred), (worker) => worker.executeEffect(req))

      yield* Deferred.await(workerDeferred).pipe(
        Effect.andThen(() =>
          Queue.takeBetween(executionBacklogQueue, 1, 100).pipe(
            Effect.tap((items) => runInWorker(new WorkerSchema.ExecuteBulk({ items: Chunk.toReadonlyArray(items) }))),
            // NOTE we're waiting a little bit for more items to come in before executing the batch
            Effect.tap(() => Effect.sleep(20)),
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
          Effect.gen(function* () {
            // TODO replace with a proper multi-tab syncing/lock-transfer mechanism
            yield* pipe(
              WebLock.waitForDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK),
              Effect.withPerformanceMeasure('@livestore/web:waitForLock'),
            )

            // NOTE here we're trying to access the persisted data directly from the main thread which
            // ususally speeds up the init process as we don't have to wait for the worker to be ready
            // This will only work for the first tab though
            const dataFromFile = yield* pipe(Effect.promise(() => getPersistedData(storageOptions, schemaHash)))
            if (dataFromFile !== undefined) return dataFromFile

            return yield* pipe(runInWorker(new WorkerSchema.Setup()))
          }).pipe(Effect.withPerformanceMeasure('@livestore/web:getInitialSnapshot'), Effect.runPromise),

        export: () => runInWorker(new WorkerSchema.Export()).pipe(Effect.runPromise),

        dangerouslyReset: (mode) =>
          Effect.gen(function* () {
            yield* pipe(runInWorker(new WorkerSchema.Shutdown({})))

            worker.terminate()

            yield* pipe(Effect.promise(() => resetPersistedData(storageOptions, schemaHash, mode)))
          }).pipe(Effect.runPromise),

        execute: async (query, bindValues) => {
          await Queue.offer(executionBacklogQueue, { _tag: 'execute', query, bindValues }).pipe(Effect.runPromise)
        },

        mutate: async (mutationEventEncoded) => {
          await Queue.offer(executionBacklogQueue, { _tag: 'mutate', mutationEventEncoded }).pipe(Effect.runPromise)
        },

        getMutationLogData: () =>
          runInWorker(new WorkerSchema.ExportMutationlog()).pipe(
            Effect.timeoutDieMsg({ error: 'Timed out after 10sec', duration: 10_000 }),
            Effect.runPromise,
          ),

        shutdown: () =>
          Effect.gen(function* () {
            yield* pipe(
              runInWorker(new WorkerSchema.Shutdown({})).pipe(Effect.andThen(() => worker.terminate())),
              // In case the graceful shutdown didn't finish in time, we terminate the worker
              Effect.race(
                Effect.sync(() => {
                  console.warn('[livestore] Worker did not gracefully shutdown in time, terminating it')
                  worker.terminate()
                }).pipe(Effect.delay(1000)),
              ),
            )

            yield* Deferred.succeed(lockDeferred, undefined)

            yield* Scope.close(manualScope, Exit.interrupt(FiberId.none))
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

const resetPersistedData = async (storage: WorkerSchema.StorageType, schemaHash: number, resetMode: ResetMode) => {
  switch (storage.type) {
    case 'opfs': {
      const dirHandle = await getOpfsDirHandle(storage.directory)
      await dirHandle.removeEntry(getAppDbFileName(storage.filePrefix, schemaHash))
      if (resetMode === 'all-data') {
        await dirHandle.removeEntry(getMutationlogDbFileName(storage.filePrefix))
      }
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
}
