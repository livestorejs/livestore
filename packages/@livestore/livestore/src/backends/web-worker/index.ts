import type * as otel from '@opentelemetry/api'
import * as Comlink from 'comlink'

import type { ParamsObject } from '../../util.js'
import { prepareBindValues } from '../../util.js'
import { BaseBackend } from '../base.js'
import type { BackendOtelProps, SelectResponse, WritableDatabaseLocation } from '../index.js'
import type { WrappedWorker } from './worker.js'

export type BackendOptionsWeb = {
  /** Specifies where to persist data for this backend */
  persistentDatabaseLocation: WritableDatabaseLocation
}

export class WebWorkerBackend extends BaseBackend {
  worker: Comlink.Remote<WrappedWorker>
  persistentDatabaseLocation: WritableDatabaseLocation
  otelTracer: otel.Tracer

  executionBacklog: { query: string; bindValues?: ParamsObject }[] = []
  executionPromise: Promise<void> | undefined = undefined

  private constructor({
    worker,
    persistentDatabaseLocation,
    otelTracer,
  }: {
    worker: Comlink.Remote<WrappedWorker>
    persistentDatabaseLocation: WritableDatabaseLocation
    otelTracer: otel.Tracer
  }) {
    super()
    this.worker = worker
    this.persistentDatabaseLocation = persistentDatabaseLocation
    this.otelTracer = otelTracer
  }

  static load = async ({ persistentDatabaseLocation }: BackendOptionsWeb) => {
    // TODO: Importing the worker like this only works with Vite;
    // should this really be inside the LiveStore library?
    // Doesn't work with Firefox right now during dev https://bugzilla.mozilla.org/show_bug.cgi?id=1247687
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    })
    const wrappedWorker = Comlink.wrap<WrappedWorker>(worker)

    await wrappedWorker.initialize({ persistentDatabaseLocation })

    return ({ otelTracer }: BackendOtelProps) =>
      new WebWorkerBackend({
        worker: wrappedWorker,
        persistentDatabaseLocation,
        otelTracer,
      })
  }

  execute = (query: string, bindValues_?: ParamsObject) => {
    const bindValues = prepareBindValues(bindValues_ ?? {}, query)
    this.executionBacklog.push({ query, bindValues })

    // Instead of sending the queries to the worker immediately, we wait a bit and batch them up (which reduces the number of messages sent to the worker)
    if (this.executionPromise === undefined) {
      this.executionPromise = new Promise((resolve) => {
        setTimeout(() => {
          void this.worker.executeBulk(this.executionBacklog)
          this.executionBacklog = []
          this.executionPromise = undefined

          resolve()
        }, 10)
      })
    }
  }

  select = async <T>(query: string, bindValues?: ParamsObject): Promise<SelectResponse<T>> => {
    // NOTE we need to wait for the executionBacklog to be worked off, before we run the select query (as it might depend on the previous execution queries)
    await this.executionPromise

    try {
      const response = (await this.worker.select(query, bindValues)) as SelectResponse<T>
      return response
    } catch (e) {
      console.error(`Error while executing query via "select": ${query}`)
      throw e
    }
  }

  getPersistedData = async (_parentSpan?: otel.Span): Promise<Uint8Array> => {
    // NOTE we need to wait for the executionBacklog to be worked off
    await this.executionPromise

    return this.worker.getPersistedData()
  }
}
