import type { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Schema, UrlParams } from '@livestore/utils/effect'
import { SearchParamsSchema, SyncMessage } from '../common/mod.ts'
import type { SearchParams } from '../common/mod.ts'

export interface Env {
  /** Eventlog database */
  DB: CfTypes.D1Database
  ADMIN_SECRET: string
}

export type MakeDurableObjectClassOptions = {
  onPush?: (
    message: SyncMessage.PushRequest,
    context: { storeId: StoreId; payload?: Schema.JsonValue },
  ) => Effect.SyncOrPromiseOrEffect<void>
  onPushRes?: (message: SyncMessage.PushAck | InvalidPushError) => Effect.SyncOrPromiseOrEffect<void>
  onPull?: (
    message: SyncMessage.PullRequest,
    context: { storeId: StoreId; payload?: Schema.JsonValue },
  ) => Effect.SyncOrPromiseOrEffect<void>
  onPullRes?: (message: SyncMessage.PullResponse | InvalidPullError) => Effect.SyncOrPromiseOrEffect<void>
  // TODO make storage configurable: D1, DO SQLite, later: external SQLite

  /**
   * Enabled transports for sync backend
   * - `http`: HTTP JSON-RPC
   * - `ws`: WebSocket
   * - `do-rpc`: Durable Object RPC calls (only works in combination with `@livestore/adapter-cf`)
   *
   * @default Set(['http', 'ws', 'do-rpc'])
   */
  enabledTransports?: Set<'http' | 'ws' | 'do-rpc'>

  otel?: {
    baseUrl?: string
    serviceName?: string
  }
}

export type StoreId = string
export type DurableObjectId = string

/**
 * Needs to be bumped when the storage format changes (e.g. eventlogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 7

export const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(SyncMessage.BackendToClientMessage))
export const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(SyncMessage.ClientToBackendMessage))

/**
 * Extracts the LiveStore sync search parameters from a request. Returns
 * `undefined` when the request does not carry valid sync metadata so callers
 * can fall back to custom routing.
 */
export const matchSyncRequest = (request: CfTypes.Request): SearchParams | undefined => {
  const url = new URL(request.url)
  const urlParams = UrlParams.fromInput(url.searchParams)
  const paramsResult = UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.option, Effect.runSync)

  if (paramsResult._tag === 'None') {
    return undefined
  }

  return paramsResult.value
}

export const MAX_PULL_EVENTS_PER_MESSAGE = 100

// Cloudflare hibernated WebSocket frames begin failing just below 1MB. Keep our
// payloads comfortably beneath that ceiling so we don't rely on implementation
// quirks of local dev servers.
export const MAX_WS_MESSAGE_BYTES = 900_000

// RPC subscription storage (TODO refactor)
export type RpcSubscription = {
  storeId: StoreId
  payload?: Schema.JsonValue
  subscribedAt: number
  /** Effect RPC request ID */
  requestId: string
  callerContext: {
    bindingName: string
    durableObjectId: string
  }
}

/**
 * Durable Object interface supporting the DO RPC protocol for DO <> DO syncing.
 */
export interface SyncBackendRpcInterface {
  __DURABLE_OBJECT_BRAND: never
  rpc(payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream>
}

export const WebSocketAttachmentSchema = Schema.parseJson(
  Schema.Struct({
    // Same across all websocket connections
    storeId: Schema.String,
    // Different for each websocket connection
    payload: Schema.optional(Schema.JsonValue),
    pullRequestIds: Schema.Array(Schema.String),
  }),
)
