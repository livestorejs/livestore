// A backend represents a raw SQLite database.
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
import { casesHandled } from '../util.js'
import type { BackendOptionsTauri } from './tauri.js'
import type { BackendOptionsWeb } from './web.js'
import { WebWorkerBackend } from './web.js'
import type { BackendOptionsWebInMemory } from './web-in-memory.js'
import { WebInMemoryBackend } from './web-in-memory.js'

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

export interface Backend {
  // Select some data from the DB.
  // This should only do reads, not writes, but we don't strongly enforce that.
  select<T = any>(query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): Promise<SelectResponse<T>>

  // Execute a query where you don't care about the result.
  // Used for writes and configuration changes.
  execute(query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): void

  /** Apply an event to the backend */
  applyEvent(event: LiveStoreEvent, eventDefiniton: ActionDefinition, parentSpan?: otel.Span): void

  /** Return a snapshot of persisted data from the backend */
  getPersistedData(parentSpan?: otel.Span): Promise<Uint8Array>
}

export type BackendType = 'tauri' | 'web' | 'web-in-memory'

export const isBackendType = (type: string): type is BackendType => {
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

export type BackendOptions = BackendOptionsTauri | BackendOptionsWeb | BackendOptionsWebInMemory

export const createBackend = async (options: BackendOptions): Promise<Backend> => {
  switch (options.type) {
    case 'tauri': {
      // NOTE Dynamic import is needed to avoid Tauri is a dependency of LiveStore (e.g. when used in the web)
      const { TauriBackend } = await import('./tauri.js')
      return await TauriBackend.load(options)
    }
    case 'web': {
      return WebWorkerBackend.load(options)
    }
    // NOTE currently only needed for testing
    case 'web-in-memory': {
      return WebInMemoryBackend.load(options)
    }
    default: {
      casesHandled(options)
    }
  }
}
