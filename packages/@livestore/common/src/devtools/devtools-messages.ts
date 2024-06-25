import { version as pkgVersion } from '@livestore/common/package.json'
import { Schema } from '@livestore/utils/effect'
import { type SqliteDsl as __SqliteDsl } from 'effect-db-schema'

import { NetworkStatus } from '../adapter-types.js'
import { DebugInfo } from '../debug-info.js'
import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'
import { PreparedBindValues } from '../util.js'

const requestId = Schema.String
const channelId = Schema.String
const liveStoreVersion = Schema.Literal(pkgVersion)

export class SnapshotReq extends Schema.TaggedStruct('LSD.SnapshotReq', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class SnapshotRes extends Schema.TaggedStruct('LSD.SnapshotRes', {
  liveStoreVersion,
  requestId,
  snapshot: Schema.Uint8Array,
}) {}

export class DebugInfoReq extends Schema.TaggedStruct('LSD.DebugInfoReq', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class DebugInfoRes extends Schema.TaggedStruct('LSD.DebugInfoRes', {
  liveStoreVersion,
  requestId,
  debugInfo: DebugInfo,
}) {}

export class DebugInfoResetReq extends Schema.TaggedStruct('LSD.DebugInfoResetReq', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class DebugInfoResetRes extends Schema.TaggedStruct('LSD.DebugInfoResetRes', {
  liveStoreVersion,
  requestId,
}) {}

export class DebugInfoRerunQueryReq extends Schema.TaggedStruct('LSD.DebugInfoRerunQueryReq', {
  liveStoreVersion,
  requestId,
  channelId,
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
}) {}

export class DebugInfoRerunQueryRes extends Schema.TaggedStruct('LSD.DebugInfoRerunQueryRes', {
  liveStoreVersion,
  requestId,
}) {}

export class MutationBroadcast extends Schema.TaggedStruct('LSD.MutationBroadcast', {
  liveStoreVersion,
  requestId,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}) {}

export class MutationLogReq extends Schema.TaggedStruct('LSD.MutationLogReq', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class MutationLogRes extends Schema.TaggedStruct('LSD.MutationLogRes', {
  liveStoreVersion,
  requestId,
  mutationLog: Schema.Uint8Array,
}) {}

export class SignalsSubscribe extends Schema.TaggedStruct('LSD.SignalsSubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
  includeResults: Schema.Boolean,
}) {}

export class SignalsUnsubscribe extends Schema.TaggedStruct('LSD.SignalsUnsubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class SignalsRes extends Schema.TaggedStruct('LSD.SignalsRes', {
  liveStoreVersion,
  requestId,
  signals: Schema.Any,
}) {}

export class LiveQueriesSubscribe extends Schema.TaggedStruct('LSD.LiveQueriesSubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

export class LiveQueriesUnsubscribe extends Schema.TaggedStruct('LSD.LiveQueriesUnsubscribe', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

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

export class LiveQueriesRes extends Schema.TaggedStruct('LSD.LiveQueriesRes', {
  liveStoreVersion,
  requestId,
  liveQueries: Schema.Array(SerializedLiveQuery),
}) {}

export class ResetAllDataReq extends Schema.TaggedStruct('LSD.ResetAllDataReq', {
  liveStoreVersion,
  requestId,
  channelId,
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class ResetAllDataRes extends Schema.TaggedStruct('LSD.ResetAllDataRes', {
  liveStoreVersion,
  requestId,
}) {}

export class NetworkStatusBroadcast extends Schema.TaggedStruct('LSD.NetworkStatusBroadcast', {
  liveStoreVersion,
  channelId,
  networkStatus: NetworkStatus,
}) {}

export class DevtoolsReadyBroadcast extends Schema.TaggedStruct('LSD.DevtoolsReadyBroadcast', {
  liveStoreVersion,
}) {}

export class DevtoolsConnected extends Schema.TaggedStruct('LSD.DevtoolsConnected', {
  liveStoreVersion,
  channelId,
}) {}

export class AppHostReadyBroadcast extends Schema.TaggedStruct('LSD.AppHostReadyBroadcast', {
  liveStoreVersion,
  channelId,
}) {}

export class Disconnect extends Schema.TaggedStruct('LSD.Disconnect', {
  liveStoreVersion,
  requestId,
  channelId,
}) {}

// export class SchemaChanged extends Schema.TaggedStruct('LSD.SchemaChanged', {
//   requestId,
// }) {}

export const MessageToAppHost = Schema.Union(
  SnapshotReq,
  MutationLogReq,
  DebugInfoReq,
  DebugInfoResetReq,
  DebugInfoRerunQueryReq,
  SignalsSubscribe,
  SignalsUnsubscribe,
  LiveQueriesSubscribe,
  LiveQueriesUnsubscribe,
  ResetAllDataReq,
  DevtoolsReadyBroadcast,
  Disconnect,
  DevtoolsConnected,
)

export type MessageToAppHost = typeof MessageToAppHost.Type

export const MessageFromAppHost = Schema.Union(
  SnapshotRes,
  MutationLogRes,
  DebugInfoRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  SignalsRes,
  LiveQueriesRes,
  ResetAllDataRes,
  Disconnect,
  // SchemaChanged,
  MutationBroadcast,
  AppHostReadyBroadcast,
  NetworkStatusBroadcast,
)

export type MessageFromAppHost = typeof MessageFromAppHost.Type

// TODO make specific over app key
export const makeBroadcastChannels = () => ({
  fromAppHost: new BroadcastChannel(`livestore-devtools-from-app-host`),
  toAppHost: new BroadcastChannel(`livestore-devtools-to-app-host`),
})
