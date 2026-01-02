import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

export class PushRpc extends Rpc.make('push', {
  payload: {
    storeId: Schema.String,
    batch: Schema.NonEmptyArray(LiveStoreEvent.Global.Encoded),
  },
  success: Schema.Void,
  error: InvalidPushError,
}) {}

export class PullRpc extends Rpc.make('pull', {
  payload: {
    storeId: Schema.String,
    cursor: EventSequenceNumber.Global.Schema,
    live: Schema.Boolean,
  },
  stream: true,
  success: Schema.NonEmptyArray(LiveStoreEvent.Global.Encoded),
  error: InvalidPullError,
}) {}

export class PingRpc extends Rpc.make('ping') {}

export const SyncRpcGroup = RpcGroup.make(PushRpc, PullRpc, PingRpc)
