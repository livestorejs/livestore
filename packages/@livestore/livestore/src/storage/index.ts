// A storage represents a raw SQLite database.
// Examples include:
// - A native SQLite process running in a Tauri Rust process
// - A SQL.js WASM version of SQLite running in a web worker
//
// We can send commands to execute various kinds of queries,
// and respond to various events from the database.

import type * as otel from '@opentelemetry/api'

import type { PreparedBindValues } from '../util.js'

export type StorageInit = (otelProps: StorageOtelProps) => Promise<Storage> | Storage

export interface Storage {
  // TODO consider transferables for `bindValues` (e.g. Uint8Array values)
  execute(query: string, bindValues?: PreparedBindValues, parentSpan?: otel.Span): void

  /** Return a snapshot of persisted data from the storage */
  getPersistedData(parentSpan?: otel.Span): Promise<Uint8Array>
}

export type StorageType = 'tauri' | 'web' | 'web-in-memory'

export type StorageOtelProps = {
  otelTracer: otel.Tracer
  parentSpan: otel.Span
}
