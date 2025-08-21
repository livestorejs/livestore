import type { CfTypes } from '@livestore/common-cf'
import { Effect, type Option, Schema, UrlParams } from '@livestore/utils/effect'
import { SearchParamsSchema, SyncMessage } from '../common/mod.ts'

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
  onPushRes?: (message: SyncMessage.PushAck | SyncMessage.SyncError) => Effect.SyncOrPromiseOrEffect<void>
  onPull?: (
    message: SyncMessage.PullRequest,
    context: { storeId: StoreId; payload?: Schema.JsonValue },
  ) => Effect.SyncOrPromiseOrEffect<void>
  onPullRes?: (message: SyncMessage.PullResponse | SyncMessage.SyncError) => Effect.SyncOrPromiseOrEffect<void>
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
}

export type StoreId = string
export type DurableObjectId = string

/**
 * Needs to be bumped when the storage format changes (e.g. eventlogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 7

export const DEFAULT_SYNC_DURABLE_OBJECT_NAME = 'SYNC_BACKEND_DO'

export const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(SyncMessage.BackendToClientMessage))
export const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(SyncMessage.ClientToBackendMessage))

export const getSyncRequestSearchParams = (request: CfTypes.Request): Option.Option<typeof SearchParamsSchema.Type> => {
  const url = new URL(request.url)
  const urlParams = UrlParams.fromInput(url.searchParams)
  const paramsResult = UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.option, Effect.runSync)

  return paramsResult
}

export const PULL_CHUNK_SIZE = 100

// RPC subscription storage (TODO refactor)
export type RpcSubscription = {
  clientId: string
  storeId: StoreId
  payload?: Schema.JsonValue
  subscribedAt: number
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
