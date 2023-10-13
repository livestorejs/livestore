import { notYetImplemented } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import * as Comlink from 'comlink'

import type { ParamsObject } from '../../util.js'
import { prepareBindValues } from '../../util.js'
import type { Storage, StorageOtelProps } from '../index.js'
import type { WrappedWorker } from './worker.js'

/* A location of a persistent writable SQLite file */
export type WritableDatabaseLocation =
  | {
      type: 'opfs'
      virtualFilename: string
    }
  | {
      type: 'indexeddb'
      virtualFilename: string
    }
  | {
      type: 'filesystem'
      directory: string
      filename: string
    }
  | {
      type: 'volatile-in-memory'
    }

export type StorageOptionsWeb = {
  /** Specifies where to persist data for this storage */
  persistentDatabaseLocation: WritableDatabaseLocation
}

export class WebWorkerStorage implements Storage {
  worker: Comlink.Remote<WrappedWorker>
  persistentDatabaseLocation: WritableDatabaseLocation
  otelTracer: otel.Tracer

  executionBacklog: { query: string; bindValues?: ParamsObject }[] = []
  executionPromise: Promise<void> | undefined

  private constructor({
    worker,
    persistentDatabaseLocation,
    otelTracer,
    executionPromise,
  }: {
    worker: Comlink.Remote<WrappedWorker>
    persistentDatabaseLocation: WritableDatabaseLocation
    otelTracer: otel.Tracer
    executionPromise: Promise<void>
  }) {
    this.worker = worker
    this.persistentDatabaseLocation = persistentDatabaseLocation
    this.otelTracer = otelTracer
    this.executionPromise = executionPromise

    executionPromise.then(() => this.executeBacklog())
  }

  static load = ({ persistentDatabaseLocation }: StorageOptionsWeb) => {
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
        persistentDatabaseLocation,
        otelTracer,
        executionPromise: new Promise(async (resolve) => {
          await wrappedWorker.initialize({ persistentDatabaseLocation })

          resolve()
        }),
      })
  }

  execute = (query: string, bindValues_?: ParamsObject) => {
    const bindValues = prepareBindValues(bindValues_ ?? {}, query)
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

  executeBacklog = () => {
    void this.worker.executeBulk(this.executionBacklog)
    this.executionBacklog = []
    this.executionPromise = undefined
  }

  getPersistedData = async (_parentSpan?: otel.Span): Promise<Uint8Array> =>
    getPersistedData(this.persistentDatabaseLocation)
}

const getPersistedData = async (persistentDatabaseLocation: WritableDatabaseLocation): Promise<Uint8Array> => {
  if (persistentDatabaseLocation.type !== 'opfs') {
    return notYetImplemented(`Unsupported persistent database location type: ${persistentDatabaseLocation.type}`)
  }

  try {
    const rootHandle = await navigator.storage.getDirectory()
    const fileHandle = await rootHandle.getFileHandle(persistentDatabaseLocation.virtualFilename + '.db')
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    const data = new Uint8Array(buffer)

    return data
  } catch (e) {
    console.error(e)
    return new Uint8Array()
  }
}
