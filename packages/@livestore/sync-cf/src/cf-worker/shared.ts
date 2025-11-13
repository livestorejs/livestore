import type { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Schema, UrlParams } from '@livestore/utils/effect'

import type { SearchParams } from '../common/mod.ts'
import { SearchParamsSchema, SyncMessage } from '../common/mod.ts'

export type Env = {}

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
  /**
   * Storage engine for event persistence.
   * - Default: `{ _tag: 'do-sqlite' }` (Durable Object SQLite)
   * - D1: `{ _tag: 'd1', binding: string }` where `binding` is the D1 binding name in wrangler.toml.
   *
   * If omitted, the runtime defaults to DO SQLite. For backwards-compatibility, if an env binding named
   * `DB` exists and looks like a D1Database, D1 will be used.
   *
   * Trade-offs:
   * - DO SQLite: simpler deploy, data co-located with DO, not externally queryable
   * - D1: centralized DB, inspectable with DB tools, extra network hop and JSON size limits
   */
  storage?: { _tag: 'do-sqlite' } | { _tag: 'd1'; binding: string }

  /**
   * Enabled transports for sync backend
   * - `http`: HTTP JSON-RPC
   * - `ws`: WebSocket
   * - `do-rpc`: Durable Object RPC calls (only works in combination with `@livestore/adapter-cf`)
   *
   * @default Set(['http', 'ws', 'do-rpc'])
   */
  enabledTransports?: Set<'http' | 'ws' | 'do-rpc'>

  /**
   * Custom HTTP response headers for HTTP transport
   * These headers will be added to all HTTP RPC responses (Pull, Push, Ping)
   *
   * @example
   * ```ts
   * {
   *   http: {
   *     responseHeaders: {
   *       'Access-Control-Allow-Origin': '*',
   *       'Cache-Control': 'no-cache'
   *     }
   *   }
   * }
   * ```
   */
  http?: {
    responseHeaders?: Record<string, string>
  }

  otel?: {
    baseUrl?: string
    serviceName?: string
  }
}

export type StoreId = string
export type DurableObjectId = string

/**
 * CRITICAL: Increment this version whenever you modify the database schema structure.
 *
 * Bump required when:
 * - Adding/removing/renaming columns in eventlogTable or contextTable (see sqlite.ts)
 * - Changing column types or constraints
 * - Modifying primary keys or indexes
 *
 * Bump NOT required when:
 * - Changing query patterns, pagination logic, or streaming behavior
 * - Adding new tables (as long as existing table schemas remain unchanged)
 * - Updating implementation details in sync-storage.ts
 *
 * Impact: Changing this version triggers a "soft reset" - new table names are created
 * and old data becomes inaccessible (but remains in storage).
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
