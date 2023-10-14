import type * as otel from '@opentelemetry/api'

import type { ParamsObject } from '../../util.js'
import type { Storage, StorageOtelProps } from '../index.js'

export type StorageOptionsWebInMemory = {
  type: 'web-in-memory'
}

/** NOTE: This storage is currently only used for testing */
export class InMemoryStorage implements Storage {
  constructor(readonly otelTracer: otel.Tracer) {}

  static load = async (_options?: StorageOptionsWebInMemory) => {
    return ({ otelTracer }: StorageOtelProps) => new InMemoryStorage(otelTracer)
  }

  execute = (_query: string, _bindValues?: ParamsObject): void => {}

  getPersistedData = async (): Promise<Uint8Array> => new Uint8Array()
}
