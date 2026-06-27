import { Schema, Transferable } from '@livestore/utils/effect'

import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import { EventSequenceNumber } from '../schema/mod.ts'
import * as SyncState from '../sync/syncstate.ts'
import { LeaderReqResMessage, LSDMessage, LSDReqResMessage, NetworkStatus } from './devtools-messages-common.ts'

export const ResetAllDataReq = LSDReqResMessage('LSD.Leader.ResetAllDataReq', {
  mode: Schema.Literals(['all-data', 'only-app-db']),
})

export const DatabaseFileInfoReq = LSDReqResMessage('LSD.Leader.DatabaseFileInfoReq', {})

export const DatabaseFileInfo = Schema.Struct({
  fileSize: Schema.Number,
  persistenceInfo: Schema.StructWithRest(Schema.Struct({ fileName: Schema.String }), [
    Schema.Record(Schema.String, Schema.Any),
  ]),
})

export const DatabaseFileInfoRes = LSDReqResMessage('LSD.Leader.DatabaseFileInfoRes', {
  state: DatabaseFileInfo,
  eventlog: DatabaseFileInfo,
})

export const NetworkStatusSubscribe = LSDReqResMessage('LSD.Leader.NetworkStatusSubscribe', {
  subscriptionId: Schema.String,
})
export const NetworkStatusUnsubscribe = LSDReqResMessage('LSD.Leader.NetworkStatusUnsubscribe', {
  subscriptionId: Schema.String,
})

export const NetworkStatusRes = LSDReqResMessage('LSD.Leader.NetworkStatusRes', {
  networkStatus: NetworkStatus,
  subscriptionId: Schema.String,
})

export const SyncingInfoReq = LSDReqResMessage('LSD.Leader.SyncingInfoReq', {})

export const SyncingInfo = Schema.Struct({
  enabled: Schema.Boolean,
  metadata: Schema.Record(Schema.String, Schema.Any),
})

export const SyncingInfoRes = LSDReqResMessage('LSD.Leader.SyncingInfoRes', {
  syncingInfo: SyncingInfo,
})

export const SyncHistorySubscribe = LSDReqResMessage('LSD.Leader.SyncHistorySubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHistoryUnsubscribe = LSDReqResMessage('LSD.Leader.SyncHistoryUnsubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHistoryRes = LSDReqResMessage('LSD.Leader.SyncHistoryRes', {
  eventEncoded: LiveStoreEvent.Global.Encoded,
  metadata: Schema.Option(Schema.Json),
  subscriptionId: Schema.String,
})

export const SyncHeadSubscribe = LSDReqResMessage('LSD.Leader.SyncHeadSubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHeadUnsubscribe = LSDReqResMessage('LSD.Leader.SyncHeadUnsubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHeadRes = LSDReqResMessage('LSD.Leader.SyncHeadRes', {
  local: EventSequenceNumber.Client.Composite,
  upstream: EventSequenceNumber.Client.Composite,
  subscriptionId: Schema.String,
})

export const SnapshotReq = LSDReqResMessage('LSD.Leader.SnapshotReq', {})

export const SnapshotRes = LSDReqResMessage('LSD.Leader.SnapshotRes', {
  snapshot: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
})

export const LoadDatabaseFile = LeaderReqResMessage('LSD.Leader.LoadDatabaseFile', {
  payload: {
    data: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
    batchId: Schema.optional(Schema.String),
  },
  success: {},
  error: {
    cause: Schema.Union([
      Schema.TaggedStruct('unsupported-file', {}),
      Schema.TaggedStruct('unsupported-database', {}),
      Schema.TaggedStruct('unknown-error', { cause: Schema.Defect() }),
    ]),
  },
})

// TODO refactor this to use push/pull semantics
export const SyncPull = LSDMessage('LSD.Leader.SyncPull', {
  payload: SyncState.PayloadUpstream,
})

// TODO refactor this to use push/pull semantics
export const CommitEventReq = LSDReqResMessage('LSD.Leader.CommitEventReq', {
  eventEncoded: LiveStoreEvent.Input.Encoded,
})

export const CommitEventRes = LSDReqResMessage('LSD.Leader.CommitEventRes', {})

export const EventlogReq = LSDReqResMessage('LSD.Leader.EventlogReq', {})

export const EventlogRes = LSDReqResMessage('LSD.Leader.EventlogRes', {
  eventlog: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
})

export const Ping = LSDReqResMessage('LSD.Leader.Ping', {
  devtoolsProtocolVersion: Schema.optional(Schema.Number),
})

export const Pong = LSDReqResMessage('LSD.Leader.Pong', {
  devtoolsProtocolVersion: Schema.optional(Schema.Number),
})

/**
 * Sent by the app when the DevTools protocol isn't compatible.
 * Contains package versions for display and protocol versions for the actual compatibility decision.
 */
export const VersionMismatch = LSDReqResMessage('LSD.Leader.VersionMismatch', {
  /** The version running in the app */
  appVersion: Schema.String,
  /** The version that was sent by DevTools (that caused the mismatch) */
  receivedVersion: Schema.String,
  appDevtoolsProtocolVersion: Schema.Number,
  receivedDevtoolsProtocolVersion: Schema.optional(Schema.Number),
})

export const Disconnect = LSDReqResMessage('LSD.Leader.Disconnect', {})

export const SetSyncLatch = LeaderReqResMessage('LSD.Leader.SetSyncLatch', {
  payload: {
    closeLatch: Schema.Boolean,
  },
  success: {},
})

export const ResetAllData = LeaderReqResMessage('LSD.Leader.ResetAllData', {
  payload: {
    mode: Schema.Literals(['all-data', 'only-app-db']),
  },
  success: {},
})

// TODO move to `Schema.TaggedRequest` once new RPC is ready https://github.com/Effect-TS/effect/pull/4362
// export class DatabaseFileInfo_ extends Schema.TaggedRequest<DatabaseFileInfo_>()('LSD.Leader.DatabaseFileInfo', {
//   payload: {
//     requestId,
//     liveStoreVersion,
//   },
//   success: DatabaseFileInfo,
//   failure: UnknownError,
// }) {}

// export class NetworkStatus_ extends Schema.TaggedRequest<NetworkStatus_>()('LSD.Leader.NetworkStatus', {
//   payload: {
//     requestId,
//     liveStoreVersion,
//   },
//   success: NetworkStatus,
//   failure: UnknownError,
// }) {}

// export const MessageToApp_ = Schema.Union([DatabaseFileInfo_, NetworkStatus_])

// export type MessageToApp_ = typeof MessageToApp_.Type
//

export const MessageToApp = Schema.Union([
  SnapshotReq,
  LoadDatabaseFile.Request,
  EventlogReq,
  ResetAllData.Request,
  NetworkStatusSubscribe,
  NetworkStatusUnsubscribe,
  Disconnect,
  CommitEventReq,
  Ping,
  DatabaseFileInfoReq,
  SyncHistorySubscribe,
  SyncHistoryUnsubscribe,
  SyncingInfoReq,
  SyncHeadSubscribe,
  SyncHeadUnsubscribe,
  SetSyncLatch.Request,
]).annotate({ identifier: 'LSD.Leader.MessageToApp' })

export type MessageToApp = typeof MessageToApp.Type

export const MessageFromApp = Schema.Union([
  SnapshotRes,
  LoadDatabaseFile.Response,
  EventlogRes,
  Disconnect,
  SyncPull,
  NetworkStatusRes,
  CommitEventRes,
  Pong,
  VersionMismatch,
  DatabaseFileInfoRes,
  SyncHistoryRes,
  SyncingInfoRes,
  SyncHeadRes,
  ResetAllData.Success,
  SetSyncLatch.Success,
]).annotate({ identifier: 'LSD.Leader.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
