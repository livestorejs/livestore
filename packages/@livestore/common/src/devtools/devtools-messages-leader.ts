import { Schema, Transferable } from '@livestore/utils/effect'

import { NetworkStatus, UnexpectedError } from '../adapter-types.js'
import { EventId } from '../schema/mod.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import * as SyncState from '../sync/syncstate.js'
import {
  LeaderReqResMessage,
  liveStoreVersion,
  LSDMessage,
  LSDReqResMessage,
  requestId,
} from './devtools-messages-common.js'

export class ResetAllDataReq extends LSDReqResMessage('LSD.Leader.ResetAllDataReq', {
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class DatabaseFileInfoReq extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoReq', {}) {}

export class DatabaseFileInfo extends Schema.Struct({
  fileSize: Schema.Number,
  persistenceInfo: Schema.Struct({ fileName: Schema.String }, { key: Schema.String, value: Schema.Any }),
}) {}

export class DatabaseFileInfoRes extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoRes', {
  readModel: DatabaseFileInfo,
  mutationLog: DatabaseFileInfo,
}) {}

export class NetworkStatusSubscribe extends LSDReqResMessage('LSD.Leader.NetworkStatusSubscribe', {}) {}
export class NetworkStatusUnsubscribe extends LSDReqResMessage('LSD.Leader.NetworkStatusUnsubscribe', {}) {}

export class NetworkStatusRes extends LSDReqResMessage('LSD.Leader.NetworkStatusRes', {
  networkStatus: NetworkStatus,
}) {}

export class SyncingInfoReq extends LSDReqResMessage('LSD.Leader.SyncingInfoReq', {}) {}

export class SyncingInfo extends Schema.Struct({
  enabled: Schema.Boolean,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Any }),
}) {}

export class SyncingInfoRes extends LSDReqResMessage('LSD.Leader.SyncingInfoRes', {
  syncingInfo: SyncingInfo,
}) {}

export class SyncHistorySubscribe extends LSDReqResMessage('LSD.Leader.SyncHistorySubscribe', {}) {}
export class SyncHistoryUnsubscribe extends LSDReqResMessage('LSD.Leader.SyncHistoryUnsubscribe', {}) {}
export class SyncHistoryRes extends LSDReqResMessage('LSD.Leader.SyncHistoryRes', {
  mutationEventEncoded: MutationEvent.AnyEncodedGlobal,
  metadata: Schema.Option(Schema.JsonValue),
}) {}

export class SyncHeadSubscribe extends LSDReqResMessage('LSD.Leader.SyncHeadSubscribe', {}) {}
export class SyncHeadUnsubscribe extends LSDReqResMessage('LSD.Leader.SyncHeadUnsubscribe', {}) {}
export class SyncHeadRes extends LSDReqResMessage('LSD.Leader.SyncHeadRes', {
  local: EventId.EventId,
  upstream: EventId.EventId,
}) {}

export class SnapshotReq extends LSDReqResMessage('LSD.Leader.SnapshotReq', {}) {}

export class SnapshotRes extends LSDReqResMessage('LSD.Leader.SnapshotRes', {
  snapshot: Transferable.Uint8Array,
}) {}

export class LoadDatabaseFileReq extends LSDReqResMessage('LSD.Leader.LoadDatabaseFileReq', {
  data: Transferable.Uint8Array,
}) {}

export class LoadDatabaseFileRes extends LSDReqResMessage('LSD.Leader.LoadDatabaseFileRes', {
  status: Schema.Literal('ok', 'unsupported-file', 'unsupported-database'),
}) {}

// TODO refactor this to use push/pull semantics
export class SyncPull extends LSDMessage('LSD.Leader.SyncPull', {
  payload: SyncState.PayloadUpstream,
}) {}

// TODO refactor this to use push/pull semantics
export class RunMutationReq extends LSDReqResMessage('LSD.Leader.RunMutationReq', {
  mutationEventEncoded: MutationEvent.PartialAnyEncoded,
}) {}

export class RunMutationRes extends LSDReqResMessage('LSD.Leader.RunMutationRes', {}) {}

export class MutationLogReq extends LSDReqResMessage('LSD.Leader.MutationLogReq', {}) {}

export class MutationLogRes extends LSDReqResMessage('LSD.Leader.MutationLogRes', {
  mutationLog: Transferable.Uint8Array,
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
export class DatabaseFileInfo_ extends Schema.TaggedRequest<DatabaseFileInfo_>()('LSD.Leader.DatabaseFileInfo', {
  payload: {
    requestId,
    liveStoreVersion,
  },
  success: DatabaseFileInfo,
  failure: UnexpectedError,
}) {}

export class NetworkStatus_ extends Schema.TaggedRequest<NetworkStatus_>()('LSD.Leader.NetworkStatus', {
  payload: {
    requestId,
    liveStoreVersion,
  },
  success: NetworkStatus,
  failure: UnexpectedError,
}) {}

export const MessageToApp_ = Schema.Union(DatabaseFileInfo_, NetworkStatus_)

export type MessageToApp_ = typeof MessageToApp_.Type
//

export const MessageToApp = Schema.Union(
  SnapshotReq,
  LoadDatabaseFileReq,
  MutationLogReq,
  ResetAllData.Request,
  NetworkStatusSubscribe,
  NetworkStatusUnsubscribe,
  Disconnect,
  RunMutationReq,
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
  LoadDatabaseFileRes,
  MutationLogRes,
  Disconnect,
  SyncPull,
  NetworkStatusRes,
  RunMutationRes,
  Pong,
  DatabaseFileInfoRes,
  SyncHistoryRes,
  SyncingInfoRes,
  SyncHeadRes,
  ResetAllData.Response,
  SetSyncLatch.Response,
).annotations({ identifier: 'LSD.Leader.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
