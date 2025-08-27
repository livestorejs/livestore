import { InvalidPullError, InvalidPushError, IsOfflineError, UnexpectedError } from '@livestore/common'
import { LiveStoreEvent } from '@livestore/common/schema'
import { SyncMessage } from '@livestore/sync-cf/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

const commonFields = {
  clientId: Schema.String,
  storeId: Schema.String,
  payload: Schema.UndefinedOr(Schema.JsonValue),
}

// RPC definitions that mirror the SyncBackend interface
export class DoRpcProxyRpcs extends RpcGroup.make(
  // Mirror the connect method
  Rpc.make('Connect', {
    payload: Schema.Struct(commonFields),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, UnexpectedError),
  }),

  // Mirror the pull method
  Rpc.make('Pull', {
    payload: Schema.Struct({
      ...commonFields,
      ...SyncMessage.PullRequest.fields,
      live: Schema.Boolean,
    }),
    // Mirror the PullResItem from SyncBackend
    success: SyncMessage.PullResponse,
    error: Schema.Union(IsOfflineError, InvalidPullError),
    stream: true,
  }),

  // Mirror the push method
  Rpc.make('Push', {
    payload: Schema.Struct({
      ...commonFields,
      batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
    }),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, InvalidPushError),
  }),

  // Mirror the ping method
  Rpc.make('Ping', {
    payload: Schema.Struct({
      ...commonFields,
    }),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, UnexpectedError),
  }),

  // Mirror the isConnected subscription
  Rpc.make('IsConnected', {
    payload: Schema.Struct({
      ...commonFields,
    }),
    success: Schema.Boolean,
    stream: true,
  }),

  // Additional method to get metadata
  Rpc.make('GetMetadata', {
    payload: Schema.Struct({
      ...commonFields,
    }),
    success: Schema.Struct({
      name: Schema.String,
      description: Schema.String,
    }).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.JsonValue }))),
  }),
) {}
