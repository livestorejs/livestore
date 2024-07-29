import { Schema, Transferable } from '@livestore/utils/effect'

import { NetworkStatus } from '../adapter-types.js'
import { DebugInfo } from '../debug-info.js'
import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'
import { PreparedBindValues } from '../util.js'
import { liveStoreVersion as pkgVersion } from '../version.js'

const requestId = Schema.String
const channelId = Schema.String
const liveStoreVersion = Schema.Literal(pkgVersion)

const LSDMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  Schema.TaggedStruct(tag, {
    liveStoreVersion,
    ...fields,
  }).annotations({ identifier: tag })

const LSDChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
    channelId,
    ...fields,
  })

const LSDReqResMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDChannelMessage(tag, {
    requestId,
    ...fields,
  })

export class SnapshotReq extends LSDReqResMessage('LSD.SnapshotReq', {}) {}

export class SnapshotRes extends LSDReqResMessage('LSD.SnapshotRes', {
  snapshot: Transferable.Uint8Array,
}) {}

export class LoadDatabaseFileReq extends LSDReqResMessage('LSD.LoadDatabaseFileReq', {
  data: Transferable.Uint8Array,
}) {}

export class LoadDatabaseFileRes extends LSDReqResMessage('LSD.LoadDatabaseFileRes', {
  status: Schema.Literal('ok', 'unsupported-file', 'unsupported-database'),
}) {}

export class DebugInfoReq extends LSDReqResMessage('LSD.DebugInfoReq', {}) {}

export class DebugInfoRes extends LSDReqResMessage('LSD.DebugInfoRes', {
  debugInfo: DebugInfo,
}) {}

export class DebugInfoHistorySubscribe extends LSDReqResMessage('LSD.DebugInfoHistorySubscribe', {}) {}

export class DebugInfoHistoryRes extends LSDReqResMessage('LSD.DebugInfoHistoryRes', {
  debugInfoHistory: Schema.Array(DebugInfo),
}) {}

export class DebugInfoHistoryUnsubscribe extends LSDReqResMessage('LSD.DebugInfoHistoryUnsubscribe', {}) {}

export class DebugInfoResetReq extends LSDReqResMessage('LSD.DebugInfoResetReq', {}) {}

export class DebugInfoResetRes extends LSDReqResMessage('LSD.DebugInfoResetRes', {}) {}

export class DebugInfoRerunQueryReq extends LSDReqResMessage('LSD.DebugInfoRerunQueryReq', {
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
}) {}

export class DebugInfoRerunQueryRes extends LSDReqResMessage('LSD.DebugInfoRerunQueryRes', {}) {}

export class MutationBroadcast extends LSDMessage('LSD.MutationBroadcast', {
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}) {}

export class RunMutationReq extends LSDReqResMessage('LSD.RunMutationReq', {
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}) {}

export class RunMutationRes extends LSDReqResMessage('LSD.RunMutationRes', {}) {}

export class MutationLogReq extends LSDReqResMessage('LSD.MutationLogReq', {}) {}

export class MutationLogRes extends LSDReqResMessage('LSD.MutationLogRes', {
  mutationLog: Transferable.Uint8Array,
}) {}

export class ReactivityGraphSubscribe extends LSDReqResMessage('LSD.ReactivityGraphSubscribe', {
  includeResults: Schema.Boolean,
}) {}

export class ReactivityGraphUnsubscribe extends LSDReqResMessage('LSD.ReactivityGraphUnsubscribe', {}) {}

export class ReactivityGraphRes extends LSDReqResMessage('LSD.ReactivityGraphRes', {
  reactivityGraph: Schema.Any,
}) {}

export class LiveQueriesSubscribe extends LSDReqResMessage('LSD.LiveQueriesSubscribe', {}) {}

export class LiveQueriesUnsubscribe extends LSDReqResMessage('LSD.LiveQueriesUnsubscribe', {}) {}

export class SerializedLiveQuery extends Schema.Struct({
  _tag: Schema.Literal('js', 'sql', 'graphql'),
  id: Schema.Number,
  label: Schema.String,
  runs: Schema.Number,
  executionTimes: Schema.Array(Schema.Number),
  lastestResult: Schema.Any,
  activeSubscriptions: Schema.Array(
    Schema.Struct({ frames: Schema.Array(Schema.Struct({ name: Schema.String, filePath: Schema.String })) }),
  ),
}) {}

export class LiveQueriesRes extends LSDReqResMessage('LSD.LiveQueriesRes', {
  liveQueries: Schema.Array(SerializedLiveQuery),
}) {}

export class ResetAllDataReq extends LSDReqResMessage('LSD.ResetAllDataReq', {
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class ResetAllDataRes extends LSDReqResMessage('LSD.ResetAllDataRes', {}) {}

export class DatabaseFileInfoReq extends LSDReqResMessage('LSD.DatabaseFileInfoReq', {}) {}

export class DatabaseFileInfoRes extends LSDReqResMessage('LSD.DatabaseFileInfoRes', {
  dbFileSize: Schema.Number,
  mutationLogFileSize: Schema.Number,
}) {}

export class MessagePortForStoreReq extends LSDReqResMessage('LSD.MessagePortForStoreReq', {}) {}

export class MessagePortForStoreRes extends LSDReqResMessage('LSD.MessagePortForStoreRes', {
  port: Transferable.MessagePort,
}) {}

export class NetworkStatusChanged extends LSDChannelMessage('LSD.NetworkStatusChanged', {
  networkStatus: NetworkStatus,
}) {}

export class DevtoolsReady extends LSDMessage('LSD.DevtoolsReady', {}) {}

export class DevtoolsConnected extends LSDChannelMessage('LSD.DevtoolsConnected', {}) {}

export class AppHostReady extends LSDChannelMessage('LSD.AppHostReady', {
  isLeaderTab: Schema.Boolean,
}) {}

export class Disconnect extends LSDReqResMessage('LSD.Disconnect', {}) {}

export class Ping extends LSDReqResMessage('LSD.Ping', {}) {}

export class Pong extends LSDReqResMessage('LSD.Pong', {}) {}

export const MessageToAppHostCoordinator = Schema.Union(
  SnapshotReq,
  LoadDatabaseFileReq,
  MutationLogReq,
  ResetAllDataReq,
  MessagePortForStoreRes,
  DevtoolsReady,
  Disconnect,
  DevtoolsConnected,
  RunMutationReq,
  Ping,
  DatabaseFileInfoReq,
).annotations({ identifier: 'LSD.MessageToAppHostCoordinator' })

export type MessageToAppHostCoordinator = typeof MessageToAppHostCoordinator.Type

export const MessageToAppHostStore = Schema.Union(
  DebugInfoReq,
  DebugInfoHistorySubscribe,
  DebugInfoHistoryUnsubscribe,
  DebugInfoResetReq,
  DebugInfoRerunQueryReq,
  ReactivityGraphSubscribe,
  ReactivityGraphUnsubscribe,
  LiveQueriesSubscribe,
  LiveQueriesUnsubscribe,
  // Ping,
).annotations({ identifier: 'LSD.MessageToAppHostStore' })

export type MessageToAppHostStore = typeof MessageToAppHostStore.Type

export const MessageFromAppHostCoordinator = Schema.Union(
  SnapshotRes,
  LoadDatabaseFileRes,
  MutationLogRes,
  ResetAllDataRes,
  MessagePortForStoreReq,
  Disconnect,
  MutationBroadcast,
  AppHostReady,
  NetworkStatusChanged,
  RunMutationRes,
  Pong,
  DatabaseFileInfoRes,
).annotations({ identifier: 'LSD.MessageFromAppHostCoordinator' })

export type MessageFromAppHostCoordinator = typeof MessageFromAppHostCoordinator.Type

export const MessageFromAppHostStore = Schema.Union(
  DebugInfoRes,
  DebugInfoHistoryRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  ReactivityGraphRes,
  LiveQueriesRes,
  // Pong,
).annotations({ identifier: 'LSD.MessageFromAppHostStore' })

export type MessageFromAppHostStore = typeof MessageFromAppHostStore.Type
