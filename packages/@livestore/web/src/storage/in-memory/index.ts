import type { PreparedBindValues, StorageDatabase } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import type * as otel from '@opentelemetry/api'

import type { StorageInit, StorageOtelProps } from '../index.js'

export type StorageOptionsWebInMemory = {
  type: 'web-in-memory'
}

/** NOTE: This storage is currently only used for testing */
export class InMemoryStorage implements StorageDatabase {
  filename = ':memory:'

  constructor(readonly otelTracer: otel.Tracer) {}

  static load =
    (_options?: StorageOptionsWebInMemory): StorageInit =>
    ({ otelTracer }: StorageOtelProps) =>
      new InMemoryStorage(otelTracer)

  execute = async (_query: string, _bindValues?: PreparedBindValues) => {}

  mutate = async (_mutationEventEncoded: MutationEvent.Any, _parentSpan?: otel.Span | undefined) => {}

  export = async () => undefined

  getMutationLogData = async (): Promise<Uint8Array> => new Uint8Array()

  dangerouslyReset = async () => {}
}
