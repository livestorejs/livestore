import type * as otel from '@opentelemetry/api'

import type { MutationEvent, StorageInit } from '../../index.js'
import type { PreparedBindValues } from '../../utils/util.js'
import type { Storage, StorageOtelProps } from '../index.js'

export type StorageOptionsWebInMemory = {
  type: 'web-in-memory'
}

/** NOTE: This storage is currently only used for testing */
export class InMemoryStorage implements Storage {
  constructor(readonly otelTracer: otel.Tracer) {}

  static load =
    (_options?: StorageOptionsWebInMemory): StorageInit =>
    ({ otelTracer }: StorageOtelProps) =>
      new InMemoryStorage(otelTracer)

  execute = (_query: string, _bindValues?: PreparedBindValues): void => {}

  mutate = (_mutationEventEncoded: MutationEvent.Any, _parentSpan?: otel.Span | undefined) => {}

  getPersistedData = async (): Promise<Uint8Array> => new Uint8Array()

  getMutationLogData = async (): Promise<Uint8Array> => new Uint8Array()

  dangerouslyReset = async () => {}
}
