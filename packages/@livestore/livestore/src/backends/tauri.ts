import { getTraceParentHeader } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import { invoke } from '@tauri-apps/api'

import type { ParamsObject } from '../util.js'
import { prepareBindValues } from '../util.js'
import { BaseBackend } from './base.js'
import type { BackendOtelProps, SelectResponse } from './index.js'

export type BackendOptionsTauri = {
  type: 'tauri'
  dbDirPath: string
  appDbFileName: string
}

export class TauriBackend extends BaseBackend {
  constructor(
    readonly dbFilePath: string,
    readonly dbDirPath: string,
    readonly otelTracer: otel.Tracer,
    readonly parentSpan: otel.Span,
  ) {
    super()
  }

  static load = async (
    { dbDirPath, appDbFileName }: BackendOptionsTauri,
    { otelTracer, parentSpan }: BackendOtelProps,
  ): Promise<TauriBackend> => {
    const dbFilePath = `${dbDirPath}/${appDbFileName}`
    await invoke('initialize_connection', { dbName: dbFilePath, otelData: getOtelData_(parentSpan) })

    return new TauriBackend(dbFilePath, dbDirPath, otelTracer, parentSpan)
  }

  execute = (query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): void => {
    // console.log({ query, bindValues, prepared: prepareBindValues(bindValues ?? {}, query) })
    void invoke('execute', {
      dbName: this.dbFilePath,
      query,
      values: prepareBindValues(bindValues ?? {}, query),
      otelData: this.getOtelData(parentSpan),
    })
  }

  select = async <T>(query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): Promise<SelectResponse<T>> => {
    return invoke('select', {
      db: this.dbFilePath,
      query,
      values: bindValues ?? {},
      otelData: this.getOtelData(parentSpan),
    })
  }

  getPersistedData = async (parentSpan?: otel.Span): Promise<Uint8Array> => {
    const headers = new Headers()
    headers.set('traceparent', getTraceParentHeader(parentSpan ?? this.parentSpan))

    return fetch(`http://localhost:38787/get-persisted-data?file_path=${this.dbFilePath}`, { headers }).then(
      (response) => response.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    )
  }

  private getOtelData = (parentSpan?: otel.Span) => getOtelData_(parentSpan ?? this.parentSpan)!
}

const getOtelData_ = (parentSpan: otel.Span | undefined) => {
  const spanContext = parentSpan?.spanContext()
  return spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : undefined
}
