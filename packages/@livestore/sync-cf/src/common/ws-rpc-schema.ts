import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'
import * as SyncMessage from './sync-message-types.ts'

/**
 * WebSocket RPC Schema for LiveStore CF Sync Provider
 *
 * This defines the RPC endpoints available over WebSocket transport.
 * Unlike HTTP transport which uses request/response patterns for each operation,
 * WebSocket transport maintains a persistent connection and uses streaming responses.
 */
export class SyncWsRpc extends RpcGroup.make(
  Rpc.make('SyncWsRpc.Pull', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.JsonValue),
      /** Whether to keep the pull stream alive and wait for more events */
      live: Schema.Boolean,
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
  // Ping <> Pong is handled by DO WS auto-response
  // TODO add admin RPCs
) {}
