import { InvalidPullError, InvalidPushError, IsOfflineError, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
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
      args: Schema.Option(
        Schema.Struct({
          cursor: EventSequenceNumber.GlobalEventSequenceNumber,
          metadata: Schema.Option(Schema.JsonValue),
        }),
      ),
    }),
    // Mirror the PullResItem from SyncBackend
    success: Schema.Struct({
      batch: Schema.Array(
        Schema.Struct({
          eventEncoded: LiveStoreEvent.AnyEncodedGlobal,
          metadata: Schema.Option(Schema.JsonValue),
        }),
      ),
      remaining: Schema.Number,
    }),
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
