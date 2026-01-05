import { InvalidPullError, InvalidPushError, UnknownError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'
import * as SyncMessage from './sync-message-types.ts'

/**
 * HTTP RPC Schema for LiveStore HTTP Sync Provider
 *
 * Defines RPC endpoints available over HTTP transport.
 * Supports both request/response and SSE streaming patterns.
 */
export class SyncHttpRpc extends RpcGroup.make(
  Rpc.make('SyncHttpRpc.Pull', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
      ...SyncMessage.PullRequest.fields,
    }),
    success: SyncMessage.PullResponse,
    error: InvalidPullError,
    stream: true,
  }),
  Rpc.make('SyncHttpRpc.Push', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
      ...SyncMessage.PushRequest.fields,
    }),
    success: SyncMessage.PushAck,
    error: InvalidPushError,
  }),
  Rpc.make('SyncHttpRpc.Ping', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
    }),
    success: SyncMessage.Pong,
    error: UnknownError,
  }),
) {}

/**
 * WebSocket RPC Schema for LiveStore HTTP Sync Provider
 *
 * Defines RPC endpoints available over WebSocket transport.
 * Supports persistent connections and native streaming.
 */
export class SyncWsRpc extends RpcGroup.make(
  Rpc.make('SyncWsRpc.Pull', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
      ...SyncMessage.PullRequest.fields,
    }),
    success: SyncMessage.PullResponse,
    error: InvalidPullError,
    stream: true,
  }),
  Rpc.make('SyncWsRpc.Push', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
      ...SyncMessage.PushRequest.fields,
    }),
    success: SyncMessage.PushAck,
    error: InvalidPushError,
  }),
  // Ping is handled by Effect RPC internally for WebSocket
) {}
