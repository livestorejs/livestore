import type * as otel from '@opentelemetry/api'

import type { MutationEvent } from './schema/index.js'
import type { PreparedBindValues } from './util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
}

export type DatabaseImpl = {
  mainDb: MainDatabase
  storageDb: StorageDatabase
}

export type MainDatabase = {
  filename: string
  prepare(queryStr: string): PreparedStatement
  execute(queryStr: string, bindValues: PreparedBindValues | undefined): void
  dangerouslyReset(): Promise<void>
  export(): Uint8Array
}

export type StorageDatabase = {
  filename: string
  execute(queryStr: string, bindValues: PreparedBindValues | undefined, span: otel.Span | undefined): Promise<void>
  mutate(mutationEventEncoded: MutationEvent.Any, span: otel.Span): Promise<void>
  dangerouslyReset(): Promise<void>
  export(span: otel.Span | undefined): Promise<Uint8Array | undefined>
  getMutationLogData(): Promise<Uint8Array>
}

export type DatabaseFactory = (opts: {
  otelTracer: otel.Tracer
  otelContext: otel.Context
}) => DatabaseImpl | Promise<DatabaseImpl>
