import { InvalidPullError, InvalidPushError, UnknownError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'
import * as SyncMessage from './sync-message-types.ts'

/**
 * HTTP RPC Schema for LiveStore CF Sync Provider
 *
 * This defines the RPC endpoints available over HTTP transport.
 * Unlike WebSocket transport which maintains persistent connections,
 * HTTP transport uses request/response patterns for each operation.
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
