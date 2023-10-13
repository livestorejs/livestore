// A storage represents a raw SQLite database.
// Examples include:
// - A native SQLite process running in a Tauri Rust process
// - A SQL.js WASM version of SQLite running in a web worker
//
// We can send commands to execute various kinds of queries,
// and respond to various events from the database.

import type * as otel from '@opentelemetry/api'

import type { LiveStoreEvent } from '../events.js'
import type { ActionDefinition } from '../schema.js'
import type { ParamsObject } from '../util.js'

export type StorageInit = (otelProps: StorageOtelProps) => Promise<Storage> | Storage

export interface Storage {
  // Select some data from the DB.
  // This should only do reads, not writes, but we don't strongly enforce that.
  select<T = any>(query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): Promise<SelectResponse<T>>

  // Execute a query where you don't care about the result.
  // Used for writes and configuration changes.
  execute(query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): void

  /** Apply an event to the storage */
  applyEvent(event: LiveStoreEvent, eventDefiniton: ActionDefinition, parentSpan?: otel.Span): void

  /** Return a snapshot of persisted data from the storage */
  getPersistedData(parentSpan?: otel.Span): Promise<Uint8Array>
}

export type StorageType = 'tauri' | 'web' | 'web-in-memory'

export const isStorageType = (type: string): type is StorageType => {
  return type === 'tauri' || type === 'web' || type === 'web-in-memory'
}

export type SelectResponse<T = any> = {
  results: T[]

  // other perf stats metadata about how long the query took
  [key: string]: any
}

export enum IndexType {
  Basic = 'Basic',
  FullText = 'FullText',
}

export type StorageOtelProps = {
  otelTracer: otel.Tracer
  parentSpan: otel.Span
}
