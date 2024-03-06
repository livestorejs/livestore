import type { PreparedBindValues, StorageDatabase } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { casesHandled, notYetImplemented } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import * as Comlink from 'comlink'

import type { StorageOtelProps } from '../index.js'
import { IDB } from '../utils/idb.js'
import type { ExecutionBacklogItem } from './common.js'
import type { WrappedWorker } from './make-worker.js'

export type StorageType = 'opfs' | 'indexeddb'

export type StorageOptionsWeb = {
  /** Specifies where to persist data for this storage */
  type: StorageType
  fileName: string
  worker: Worker | (new (options?: { name: string }) => Worker)
}

export class WebWorkerStorage implements StorageDatabase {
  filename: string
  worker: Worker
  wrappedWorker: Comlink.Remote<WrappedWorker>
  options: StorageOptionsWeb
  otelTracer: otel.Tracer

  executionBacklog: ExecutionBacklogItem[] = []
  executionPromise: Promise<void> | undefined

  private constructor({
    filename,
    worker,
    wrappedWorker,
    options,
    otelTracer,
    executionPromise,
  }: {
    filename: string
    worker: Worker
    wrappedWorker: Comlink.Remote<WrappedWorker>
    options: StorageOptionsWeb
    otelTracer: otel.Tracer
    executionPromise: Promise<void>
  }) {
    this.filename = filename
    this.worker = worker
    this.wrappedWorker = wrappedWorker
    this.options = options
    this.otelTracer = otelTracer
    this.executionPromise = executionPromise

    executionPromise.then(() => this.executeBacklog())
  }

  static load = (options: StorageOptionsWeb) => {
    const worker = options.worker instanceof Worker ? options.worker : new options.worker({ name: 'livestore-worker' })
    // TODO replace Comlink with Effect worker
    const wrappedWorker = Comlink.wrap<WrappedWorker>(worker)

    return ({ otelTracer }: StorageOtelProps) =>
      new WebWorkerStorage({
        filename: options.fileName,
        worker,
        wrappedWorker,
        options,
        otelTracer,
        executionPromise: wrappedWorker.initialize({ fileName: options.fileName, type: options.type }),
      })
  }

  execute = async (query: string, bindValues?: PreparedBindValues, _parentSpan?: otel.Span | undefined) => {
    this.executionBacklog.push({ _tag: 'execute', query, bindValues })
    this.scheduleExecution()
  }

  mutate = async (mutationEventEncoded: MutationEvent.Any, _parentSpan?: otel.Span | undefined) => {
    this.executionBacklog.push({ _tag: 'mutate', mutationEventEncoded })
    this.scheduleExecution()
  }

  private scheduleExecution = () => {
    // Instead of sending the queries to the worker immediately, we wait a bit and batch them up (which reduces the number of messages sent to the worker)
    if (this.executionPromise === undefined) {
      this.executionPromise = new Promise((resolve) => {
        setTimeout(() => {
          this.executeBacklog()

          resolve()
        }, 10)
      })
    }
  }

  private executeBacklog = () => {
    void this.wrappedWorker.executeBulk(this.executionBacklog)
    this.executionBacklog = []
    this.executionPromise = undefined
  }

  export = async (_parentSpan?: otel.Span) => getPersistedData(this.options)

  getMutationLogData = async (_parentSpan?: otel.Span) => getMutationLogData(this.options)

  dangerouslyReset = async () => {
    // TODO implement graceful shutdown
    this.worker.terminate()
    await resetPersistedData(this.options)
  }
}

const getPersistedData = async (options: StorageOptionsWeb) => {
  switch (options.type) {
    case 'opfs': {
      try {
        const rootHandle = await navigator.storage.getDirectory()
        const fileHandle = await rootHandle.getFileHandle(options.fileName)
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
      const idb = new IDB(options.fileName)

      return (await idb.get('db')) ?? new Uint8Array()
    }
    default: {
      casesHandled(options.type)
    }
  }
}

const getMutationLogData = async (options: StorageOptionsWeb): Promise<Uint8Array> => {
  switch (options.type) {
    case 'opfs': {
      try {
        const rootHandle = await navigator.storage.getDirectory()
        const fileHandle = await rootHandle.getFileHandle(`${options.fileName}-log.db`)
        const file = await fileHandle.getFile()
        const buffer = await file.arrayBuffer()
        const data = new Uint8Array(buffer)

        return data
      } catch (error: any) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          return new Uint8Array()
        }

        throw error
      }
    }

    case 'indexeddb': {
      return notYetImplemented()
    }
    default: {
      casesHandled(options.type)
    }
  }
}

const resetPersistedData = async (options: StorageOptionsWeb) => {
  switch (options.type) {
    case 'opfs': {
      const rootHandle = await navigator.storage.getDirectory()
      await rootHandle.removeEntry(options.fileName)
      await rootHandle.removeEntry(`${options.fileName}-log.db`)
      break
    }

    case 'indexeddb': {
      const idb = new IDB(options.fileName)
      await idb.deleteDb()
      break
    }
    default: {
      casesHandled(options.type)
    }
  }
}
