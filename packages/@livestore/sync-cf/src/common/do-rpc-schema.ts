import { BackendIdMismatchError, ServerAheadError, UnknownError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

import * as SyncMessage from './sync-message-types.ts'

export const SyncDoRpcPullPayload = Schema.Struct({
  /** Omitting the cursor will start from the beginning */
  cursor: SyncMessage.PullRequest.fields.cursor,
  /**
   * Present for a live pull. The backend keeps delivering later events through the callback stub passed
   * alongside the native RPC call and files the subscription under this client-minted id.
   */
  live: Schema.optional(Schema.Struct({ subscriptionId: Schema.String })),
  /**
   * While the storeId is already implied by the Durable Object, we still need the explicit storeId
   * since a DO doesn't know its own id.name value. 🫠
   * https://community.cloudflare.com/t/how-can-i-get-the-name-of-a-durable-object-from-itself/505961/8
   */
  storeId: Schema.String,
  /** Needed for various reasons (e.g. auth) */
  payload: Schema.optional(Schema.Json),
})

export class SyncDoRpc extends RpcGroup.make(
  Rpc.make('SyncDoRpc.Pull', {
    payload: SyncDoRpcPullPayload,
    success: Schema.Struct({
      rpcRequestId: Schema.String,
      ...SyncMessage.PullResponse.fields,
    }),
    error: Schema.Union([UnknownError, BackendIdMismatchError]),
    stream: true,
  }),
  Rpc.make('SyncDoRpc.Push', {
    payload: Schema.Struct({
      ...SyncMessage.PushRequest.fields,
      storeId: Schema.String,
      payload: Schema.optional(Schema.Json),
    }),
    success: SyncMessage.PushAck,
    error: Schema.Union([UnknownError, ServerAheadError, BackendIdMismatchError]),
  }),
  Rpc.make('SyncDoRpc.Ping', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.Json),
    }),
    success: Schema.Void,
  }),
  Rpc.make('SyncDoRpc.Unsubscribe', {
    payload: Schema.Struct({
      /** Id the live pull was filed under; only its minter knows it. */
      subscriptionId: Schema.String,
      storeId: Schema.String,
      payload: Schema.optional(Schema.Json),
    }),
    success: Schema.Void,
  }),
) {}
