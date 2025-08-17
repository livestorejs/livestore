import { InvalidPullError, InvalidPushError, IsOfflineError, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

// RPC definitions that mirror the SyncBackend interface
export class SyncProxyRpcs extends RpcGroup.make(
  // Mirror the connect method
  Rpc.make('Connect', {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, UnexpectedError),
  }),

  // Mirror the pull method
  Rpc.make('Pull', {
    payload: Schema.Option(
      Schema.Struct({
        cursor: EventSequenceNumber.EventSequenceNumber,
        metadata: Schema.Option(Schema.Option(Schema.JsonValue)),
      }),
    ),
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
      batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
    }),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, InvalidPushError),
  }),

  // Mirror the ping method
  Rpc.make('Ping', {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: Schema.Union(IsOfflineError, UnexpectedError),
  }),

  // Mirror the isConnected subscription
  Rpc.make('IsConnected', {
    payload: Schema.Struct({}),
    success: Schema.Boolean,
    stream: true,
  }),

  // Additional method to get metadata
  Rpc.make('GetMetadata', {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      name: Schema.String,
      description: Schema.String,
    }).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.JsonValue }))),
  }),
) {}
