import { Schema, Transferable } from '@livestore/utils/effect'

import { NetworkStatus } from '../adapter-types.js'
import { DebugInfo } from '../debug-info.js'
import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'
import { PreparedBindValues } from '../util.js'
import { liveStoreVersion as pkgVersion } from '../version.js'

const requestId = Schema.String
const channelId = Schema.String
const liveStoreVersion = Schema.Literal(pkgVersion)

export class SnapshotReq extends Schema.TaggedStruct('LSD.SnapshotReq', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.SnapshotReq' }) {}

export class SnapshotRes extends Schema.TaggedStruct('LSD.SnapshotRes', {
  liveStoreVersion,
  requestId,
  snapshot: Transferable.Uint8Array,
}).annotations({ identifier: 'LSD.SnapshotRes' }) {}

export class LoadDatabaseFileReq extends Schema.TaggedStruct('LSD.LoadDatabaseFileReq', {
  liveStoreVersion,
  requestId,
  channelId,
  data: Transferable.Uint8Array,
}).annotations({ identifier: 'LSD.LoadDatabaseFileReq' }) {}

export class LoadDatabaseFileRes extends Schema.TaggedStruct('LSD.LoadDatabaseFileRes', {
  liveStoreVersion,
  requestId,
  status: Schema.Literal('ok', 'unsupported-file', 'unsupported-database'),
}).annotations({ identifier: 'LSD.LoadDatabaseFileRes' }) {}

export class DebugInfoReq extends Schema.TaggedStruct('LSD.DebugInfoReq', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.DebugInfoReq' }) {}

export class DebugInfoRes extends Schema.TaggedStruct('LSD.DebugInfoRes', {
  liveStoreVersion,
  requestId,
  debugInfo: DebugInfo,
}).annotations({ identifier: 'LSD.DebugInfoRes' }) {}

export class DebugInfoResetReq extends Schema.TaggedStruct('LSD.DebugInfoResetReq', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.DebugInfoResetReq' }) {}

export class DebugInfoResetRes extends Schema.TaggedStruct('LSD.DebugInfoResetRes', {
  liveStoreVersion,
  requestId,
}).annotations({ identifier: 'LSD.DebugInfoResetRes' }) {}

export class DebugInfoRerunQueryReq extends Schema.TaggedStruct('LSD.DebugInfoRerunQueryReq', {
  liveStoreVersion,
  requestId,
  channelId,
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
}).annotations({ identifier: 'LSD.DebugInfoRerunQueryReq' }) {}

export class DebugInfoRerunQueryRes extends Schema.TaggedStruct('LSD.DebugInfoRerunQueryRes', {
  liveStoreVersion,
  requestId,
}).annotations({ identifier: 'LSD.DebugInfoRerunQueryRes' }) {}

export class MutationBroadcast extends Schema.TaggedStruct('LSD.MutationBroadcast', {
  liveStoreVersion,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}).annotations({ identifier: 'LSD.MutationBroadcast' }) {}

export class RunMutationReq extends Schema.TaggedStruct('LSD.RunMutationReq', {
  liveStoreVersion,
  requestId,
  channelId,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}).annotations({ identifier: 'LSD.RunMutationReq' }) {}

export class RunMutationRes extends Schema.TaggedStruct('LSD.RunMutationRes', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.RunMutationRes' }) {}

export class MutationLogReq extends Schema.TaggedStruct('LSD.MutationLogReq', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.MutationLogReq' }) {}

export class MutationLogRes extends Schema.TaggedStruct('LSD.MutationLogRes', {
  liveStoreVersion,
  requestId,
  channelId,
  mutationLog: Transferable.Uint8Array,
}).annotations({ identifier: 'LSD.MutationLogRes' }) {}

export class ReactivityGraphSubscribe extends Schema.TaggedStruct('LSD.ReactivityGraphSubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
  includeResults: Schema.Boolean,
}).annotations({ identifier: 'LSD.ReactivityGraphSubscribe' }) {}

export class ReactivityGraphUnsubscribe extends Schema.TaggedStruct('LSD.ReactivityGraphUnsubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.ReactivityGraphUnsubscribe' }) {}

export class ReactivityGraphRes extends Schema.TaggedStruct('LSD.ReactivityGraphRes', {
  liveStoreVersion,
  requestId,
  reactivityGraph: Schema.Any,
}).annotations({ identifier: 'LSD.ReactivityGraphRes' }) {}

export class LiveQueriesSubscribe extends Schema.TaggedStruct('LSD.LiveQueriesSubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.LiveQueriesSubscribe' }) {}

export class LiveQueriesUnsubscribe extends Schema.TaggedStruct('LSD.LiveQueriesUnsubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.LiveQueriesUnsubscribe' }) {}

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
}).annotations({ identifier: 'SerializedLiveQuery' }) {}

export class LiveQueriesRes extends Schema.TaggedStruct('LSD.LiveQueriesRes', {
  liveStoreVersion,
  requestId,
  liveQueries: Schema.Array(SerializedLiveQuery),
}).annotations({ identifier: 'LSD.LiveQueriesRes' }) {}

export class ResetAllDataReq extends Schema.TaggedStruct('LSD.ResetAllDataReq', {
  liveStoreVersion,
  requestId,
  channelId,
  mode: Schema.Literal('all-data', 'only-app-db'),
}).annotations({ identifier: 'LSD.ResetAllDataReq' }) {}

export class ResetAllDataRes extends Schema.TaggedStruct('LSD.ResetAllDataRes', {
  liveStoreVersion,
  requestId,
}).annotations({ identifier: 'LSD.ResetAllDataRes' }) {}

export class MessagePortForStoreReq extends Schema.TaggedStruct('LSD.MessagePortForStoreReq', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.MessagePortForStoreReq' }) {}

export class MessagePortForStoreRes extends Schema.TaggedStruct('LSD.MessagePortForStoreRes', {
  liveStoreVersion,
  requestId,
  channelId,
  port: Transferable.MessagePort,
}).annotations({ identifier: 'LSD.MessagePortForStoreRes' }) {}

export class NetworkStatusChanged extends Schema.TaggedStruct('LSD.NetworkStatusChanged', {
  liveStoreVersion,
  channelId,
  networkStatus: NetworkStatus,
}).annotations({ identifier: 'LSD.NetworkStatusChanged' }) {}

export class DevtoolsReady extends Schema.TaggedStruct('LSD.DevtoolsReady', {
  liveStoreVersion,
}).annotations({ identifier: 'LSD.DevtoolsReady' }) {}

export class DevtoolsConnected extends Schema.TaggedStruct('LSD.DevtoolsConnected', {
  liveStoreVersion,
  channelId,
}).annotations({ identifier: 'LSD.DevtoolsConnected' }) {}

export class AppHostReady extends Schema.TaggedStruct('LSD.AppHostReady', {
  liveStoreVersion,
  channelId,
  isLeaderTab: Schema.Boolean,
}).annotations({ identifier: 'LSD.AppHostReady' }) {}

export class Disconnect extends Schema.TaggedStruct('LSD.Disconnect', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.Disconnect' }) {}

export class Ping extends Schema.TaggedStruct('LSD.Ping', {
  liveStoreVersion,
  requestId,
  channelId,
}).annotations({ identifier: 'LSD.Ping' }) {}

export class Pong extends Schema.TaggedStruct('LSD.Pong', {
  liveStoreVersion,
  requestId,
}).annotations({ identifier: 'LSD.Pong' }) {}

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
).annotations({ identifier: 'LSD.MessageToAppHostCoordinator' })

export type MessageToAppHostCoordinator = typeof MessageToAppHostCoordinator.Type

export const MessageToAppHostStore = Schema.Union(
  DebugInfoReq,
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
).annotations({ identifier: 'LSD.MessageFromAppHostCoordinator' })

export type MessageFromAppHostCoordinator = typeof MessageFromAppHostCoordinator.Type

export const MessageFromAppHostStore = Schema.Union(
  DebugInfoRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  ReactivityGraphRes,
  LiveQueriesRes,
  // Pong,
).annotations({ identifier: 'LSD.MessageFromAppHostStore' })

export type MessageFromAppHostStore = typeof MessageFromAppHostStore.Type
