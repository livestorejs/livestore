import { Schema, Transferable } from '@livestore/utils/effect'

import * as LiveStoreEvent from '../schema/LiveStoreEvent.js'
import { EventId } from '../schema/mod.js'
import * as SyncState from '../sync/syncstate.js'
import { LeaderReqResMessage, LSDMessage, LSDReqResMessage, NetworkStatus } from './devtools-messages-common.js'

export class ResetAllDataReq extends LSDReqResMessage('LSD.Leader.ResetAllDataReq', {
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class DatabaseFileInfoReq extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoReq', {}) {}

export class DatabaseFileInfo extends Schema.Struct({
  fileSize: Schema.Number,
  persistenceInfo: Schema.Struct({ fileName: Schema.String }, { key: Schema.String, value: Schema.Any }),
}) {}

export class DatabaseFileInfoRes extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoRes', {
  state: DatabaseFileInfo,
  eventlog: DatabaseFileInfo,
}) {}

export class NetworkStatusSubscribe extends LSDReqResMessage('LSD.Leader.NetworkStatusSubscribe', {
  subscriptionId: Schema.String,
}) {}
export class NetworkStatusUnsubscribe extends LSDReqResMessage('LSD.Leader.NetworkStatusUnsubscribe', {
  subscriptionId: Schema.String,
}) {}

export class NetworkStatusRes extends LSDReqResMessage('LSD.Leader.NetworkStatusRes', {
  networkStatus: NetworkStatus,
  subscriptionId: Schema.String,
}) {}

export class SyncingInfoReq extends LSDReqResMessage('LSD.Leader.SyncingInfoReq', {}) {}

export class SyncingInfo extends Schema.Struct({
  enabled: Schema.Boolean,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Any }),
}) {}

export class SyncingInfoRes extends LSDReqResMessage('LSD.Leader.SyncingInfoRes', {
  syncingInfo: SyncingInfo,
}) {}

export class SyncHistorySubscribe extends LSDReqResMessage('LSD.Leader.SyncHistorySubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHistoryUnsubscribe extends LSDReqResMessage('LSD.Leader.SyncHistoryUnsubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHistoryRes extends LSDReqResMessage('LSD.Leader.SyncHistoryRes', {
  eventEncoded: LiveStoreEvent.AnyEncodedGlobal,
  metadata: Schema.Option(Schema.JsonValue),
  subscriptionId: Schema.String,
}) {}

export class SyncHeadSubscribe extends LSDReqResMessage('LSD.Leader.SyncHeadSubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHeadUnsubscribe extends LSDReqResMessage('LSD.Leader.SyncHeadUnsubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHeadRes extends LSDReqResMessage('LSD.Leader.SyncHeadRes', {
  local: EventId.EventId,
  upstream: EventId.EventId,
  subscriptionId: Schema.String,
}) {}

export class SnapshotReq extends LSDReqResMessage('LSD.Leader.SnapshotReq', {}) {}

export class SnapshotRes extends LSDReqResMessage('LSD.Leader.SnapshotRes', {
  snapshot: Transferable.Uint8Array,
}) {}

export const LoadDatabaseFile = LeaderReqResMessage('LSD.Leader.LoadDatabaseFile', {
  payload: {
    data: Transferable.Uint8Array,
  },
  success: {},
  error: {
    cause: Schema.Union(
      Schema.TaggedStruct('unsupported-file', {}),
      Schema.TaggedStruct('unsupported-database', {}),
      Schema.TaggedStruct('unexpected-error', { cause: Schema.Defect }),
    ),
  },
})

// TODO refactor this to use push/pull semantics
export class SyncPull extends LSDMessage('LSD.Leader.SyncPull', {
  payload: SyncState.PayloadUpstream,
}) {}

// TODO refactor this to use push/pull semantics
export class CommitEventReq extends LSDReqResMessage('LSD.Leader.CommitEventReq', {
  eventEncoded: LiveStoreEvent.PartialAnyEncoded,
}) {}

export class CommitEventRes extends LSDReqResMessage('LSD.Leader.CommitEventRes', {}) {}

export class EventlogReq extends LSDReqResMessage('LSD.Leader.EventlogReq', {}) {}

export class EventlogRes extends LSDReqResMessage('LSD.Leader.EventlogRes', {
  eventlog: Transferable.Uint8Array,
}) {}

export class Ping extends LSDReqResMessage('LSD.Leader.Ping', {}) {}

export class Pong extends LSDReqResMessage('LSD.Leader.Pong', {}) {}

export class Disconnect extends LSDReqResMessage('LSD.Leader.Disconnect', {}) {}

export const SetSyncLatch = LeaderReqResMessage('LSD.Leader.SetSyncLatch', {
  payload: {
    closeLatch: Schema.Boolean,
  },
  success: {},
})

export const ResetAllData = LeaderReqResMessage('LSD.Leader.ResetAllData', {
  payload: {
    mode: Schema.Literal('all-data', 'only-app-db'),
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
//   failure: UnexpectedError,
// }) {}

// export class NetworkStatus_ extends Schema.TaggedRequest<NetworkStatus_>()('LSD.Leader.NetworkStatus', {
//   payload: {
//     requestId,
//     liveStoreVersion,
//   },
//   success: NetworkStatus,
//   failure: UnexpectedError,
// }) {}

// export const MessageToApp_ = Schema.Union(DatabaseFileInfo_, NetworkStatus_)

// export type MessageToApp_ = typeof MessageToApp_.Type
//

export const MessageToApp = Schema.Union(
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
).annotations({ identifier: 'LSD.Leader.MessageToApp' })

export type MessageToApp = typeof MessageToApp.Type

export const MessageFromApp = Schema.Union(
  SnapshotRes,
  LoadDatabaseFile.Response,
  EventlogRes,
  Disconnect,
  SyncPull,
  NetworkStatusRes,
  CommitEventRes,
  Pong,
  DatabaseFileInfoRes,
  SyncHistoryRes,
  SyncingInfoRes,
  SyncHeadRes,
  ResetAllData.Success,
  SetSyncLatch.Success,
).annotations({ identifier: 'LSD.Leader.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
