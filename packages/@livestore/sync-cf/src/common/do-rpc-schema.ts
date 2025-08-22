import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'
import * as SyncMessage from './sync-message-types.ts'

const commonPayloadFields = {
  /**
   * While the storeId is already implied by the durable object, we still need the explicit storeId
   * since a DO doesn't know its own id.name value. 🫠
   * https://community.cloudflare.com/t/how-can-i-get-the-name-of-a-durable-object-from-itself/505961/8
   */
  storeId: Schema.String,
  /** Needed for various reasons (e.g. auth) */
  payload: Schema.optional(Schema.JsonValue),
}

export class SyncDoRpc extends RpcGroup.make(
  Rpc.make('SyncDoRpc.Subscribe', {
    payload: {
      /** The durable object ID of the client (needed for SyncDO to call back to the client). */
      durableObjectId: Schema.String,
      clientId: Schema.String,
      ...commonPayloadFields,
    },
    error: SyncMessage.SyncError,
    // Poke events
    success: Schema.String,
    stream: true,
  }),
  Rpc.make('SyncDoRpc.Unsubscribe', {
    payload: {
      durableObjectId: Schema.String,
      ...commonPayloadFields,
    },
    error: SyncMessage.SyncError,
    success: Schema.Void,
  }),
  Rpc.make('SyncDoRpc.Pull', {
    payload: {
      /** Omitting the cursor will start from the beginning */
      cursor: Schema.optional(EventSequenceNumber.GlobalEventSequenceNumber),
      /** Whether to keep the pull stream alive and wait for more events */
      live: Schema.Boolean,
      ...commonPayloadFields,
    },
    success: SyncMessage.PullResponse,
    error: SyncMessage.SyncError,
    stream: true,
  }),
  Rpc.make('SyncDoRpc.Push', {
    payload: {
      batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
      ...commonPayloadFields,
    },
    success: SyncMessage.PushAck,
    error: SyncMessage.SyncError,
  }),
  Rpc.make('SyncDoRpc.Ping', {
    payload: {
      ...commonPayloadFields,
    },
    success: Schema.Void,
  }),
) {}
