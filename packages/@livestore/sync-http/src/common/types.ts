import type { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { Effect, Schema } from '@livestore/utils/effect'
import type * as SyncMessage from './sync-message-types.ts'

/** Headers forwarded from the request to callbacks */
export type ForwardedHeaders = ReadonlyMap<string, string>

/**
 * Configuration for forwarding request headers to callbacks.
 * - `string[]`: List of header names to forward (case-insensitive)
 * - `(headers) => Record<string, string>`: Custom extraction function
 */
export type ForwardHeadersOption = readonly string[] | ((headers: Headers) => Record<string, string>)

/** Context passed to onPush/onPull callbacks */
export type CallbackContext = {
  readonly storeId: string
  readonly clientId: string
  readonly payload?: Schema.JsonValue | undefined
  /** Headers forwarded from the request (only present if `forwardHeaders` is configured) */
  readonly headers?: ForwardedHeaders | undefined
}

/** Callback type that can be sync, async, or Effect */
export type SyncOrPromiseOrEffect<T> = T | Promise<T> | Effect.Effect<T>

/** Server callbacks for handling sync operations */
export type ServerCallbacks = {
  /** Called before processing a push request */
  readonly onPush?:
    | ((message: SyncMessage.PushRequest, context: CallbackContext) => SyncOrPromiseOrEffect<void>)
    | undefined
  /** Called after a push completes */
  readonly onPushRes?: ((message: SyncMessage.PushAck | InvalidPushError) => SyncOrPromiseOrEffect<void>) | undefined
  /** Called before processing a pull request */
  readonly onPull?:
    | ((message: SyncMessage.PullRequest, context: CallbackContext) => SyncOrPromiseOrEffect<void>)
    | undefined
  /** Called after a pull completes (per response chunk) */
  readonly onPullRes?:
    | ((message: SyncMessage.PullResponse | InvalidPullError) => SyncOrPromiseOrEffect<void>)
    | undefined
}

/** HTTP live pull mode configuration */
export type HttpLivePullMode = 'sse' | 'polling'

/** Serialization format */
export type SerializationFormat = 'json' | 'msgpack'

/** Transport configuration */
export type TransportConfig = {
  http?: {
    enabled?: boolean
    /** Live pull mode: 'sse' for Server-Sent Events, 'polling' for short polling */
    livePull?: HttpLivePullMode
    /** Polling interval in milliseconds (only used when livePull is 'polling') */
    pollInterval?: number
  }
  ws?: {
    enabled?: boolean
  }
}

/** Server options */
export type SyncServerOptions = {
  port: number
  host?: string
  serialization?: SerializationFormat
  transports?: TransportConfig
  /** Forward request headers to callbacks */
  forwardHeaders?: ForwardHeadersOption
  /** Custom response headers for HTTP transport */
  responseHeaders?: Record<string, string>
} & ServerCallbacks

/** Constants for chunking */
export const MAX_TRANSPORT_PAYLOAD_BYTES = 900_000
export const MAX_PULL_EVENTS_PER_MESSAGE = 100
export const MAX_PUSH_EVENTS_PER_REQUEST = 100

/**
 * Storage format version. Increment when changing storage schema.
 * This enables graceful migrations.
 */
export const PERSISTENCE_FORMAT_VERSION = 1
