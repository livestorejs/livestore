import { casesHandled } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import * as Comlink from 'comlink'

import type { PreparedBindValues } from '../../utils/util.js'
import type { Storage, StorageOtelProps } from '../index.js'
import { IDB } from '../utils/idb.js'
import type { WrappedWorker } from './worker.js'

export type StorageType = 'opfs' | 'indexeddb'

export type StorageOptionsWeb = {
  /** Specifies where to persist data for this storage */
  type: StorageType
  fileName: string
}

export class WebWorkerStorage implements Storage {
  worker: Comlink.Remote<WrappedWorker>
  options: StorageOptionsWeb
  otelTracer: otel.Tracer

  executionBacklog: { query: string; bindValues?: PreparedBindValues }[] = []
  executionPromise: Promise<void> | undefined

  private constructor({
    worker,
    options,
    otelTracer,
    executionPromise,
  }: {
    worker: Comlink.Remote<WrappedWorker>
    options: StorageOptionsWeb
    otelTracer: otel.Tracer
    executionPromise: Promise<void>
  }) {
    this.worker = worker
    this.options = options
    this.otelTracer = otelTracer
    this.executionPromise = executionPromise

    executionPromise.then(() => this.executeBacklog())
  }

  static load = (options: StorageOptionsWeb) => {
    // TODO: Importing the worker like this only works with Vite;
    // should this really be inside the LiveStore library?
    // Doesn't work with Firefox right now during dev https://bugzilla.mozilla.org/show_bug.cgi?id=1247687
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    })
    const wrappedWorker = Comlink.wrap<WrappedWorker>(worker)

    return ({ otelTracer }: StorageOtelProps) =>
      new WebWorkerStorage({
        worker: wrappedWorker,
        options,
        otelTracer,
        executionPromise: wrappedWorker.initialize(options),
      })
  }

  execute = (query: string, bindValues?: PreparedBindValues) => {
    this.executionBacklog.push({ query, bindValues })

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
    void this.worker.executeBulk(this.executionBacklog)
    this.executionBacklog = []
    this.executionPromise = undefined
  }

  getPersistedData = async (_parentSpan?: otel.Span): Promise<Uint8Array> => getPersistedData(this.options)
}

const getPersistedData = async (options: StorageOptionsWeb): Promise<Uint8Array> => {
  switch (options.type) {
    case 'opfs': {
      try {
        const rootHandle = await navigator.storage.getDirectory()
        const fileHandle = await rootHandle.getFileHandle(options.fileName + '.db')
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
      const idb = new IDB(options.fileName)

      return (await idb.get('db')) ?? new Uint8Array()
    }
    default: {
      casesHandled(options.type)
    }
  }
}
