import { makeNoopTracer } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import type { ParamsObject } from '../util.js'
import { BaseBackend } from './base.js'
import type { SelectResponse } from './index.js'

export type BackendOptionsNoop = {
  type: 'noop'
  /** Specifies where to persist data for this backend */
  otelTracer?: otel.Tracer
}

export class NoopBackend extends BaseBackend {
  constructor(readonly otelTracer: otel.Tracer) {
    super()
  }

  static load = async (options: BackendOptionsNoop): Promise<NoopBackend> => {
    return new NoopBackend(options.otelTracer ?? makeNoopTracer())
  }

  execute = (_query: string, _bindValues?: ParamsObject): void => {}

  select = async <T>(_query: string, _bindValues?: ParamsObject): Promise<SelectResponse<T>> => {
    return { results: [] }
  }

  getPersistedData = async (): Promise<Uint8Array> => {
    return new Uint8Array()
  }
}
