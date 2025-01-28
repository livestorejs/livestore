import { Schema, Transferable } from '@livestore/utils/effect'

import { NetworkStatus } from '../adapter-types.js'
import { DebugInfo } from '../debug-info.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import { PreparedBindValues } from '../util.js'
import { liveStoreVersion as pkgVersion } from '../version.js'

const requestId = Schema.String
const clientId = Schema.String
const sessionId = Schema.String
const liveStoreVersion = Schema.Literal(pkgVersion)

const LSDMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  Schema.TaggedStruct(tag, {
    liveStoreVersion,
    ...fields,
  }).annotations({ identifier: tag })

const LSDChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
    ...fields,
  })

const LSDStoreChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
    clientId,
    sessionId,
    ...fields,
  })

const LSDStoreReqResMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
    clientId,
    sessionId,
    requestId,
    ...fields,
  })

const LSDReqResMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDChannelMessage(tag, {
    requestId,
    ...fields,
  })

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

export class DebugInfoReq extends LSDStoreReqResMessage('LSD.DebugInfoReq', {}) {}

export class DebugInfoRes extends LSDStoreReqResMessage('LSD.DebugInfoRes', {
  debugInfo: DebugInfo,
}) {}

export class DebugInfoHistorySubscribe extends LSDStoreReqResMessage('LSD.DebugInfoHistorySubscribe', {}) {}

export class DebugInfoHistoryRes extends LSDStoreReqResMessage('LSD.DebugInfoHistoryRes', {
  debugInfoHistory: Schema.Array(DebugInfo),
}) {}

export class DebugInfoHistoryUnsubscribe extends LSDStoreReqResMessage('LSD.DebugInfoHistoryUnsubscribe', {}) {}

export class DebugInfoResetReq extends LSDStoreReqResMessage('LSD.DebugInfoResetReq', {}) {}

export class DebugInfoResetRes extends LSDStoreReqResMessage('LSD.DebugInfoResetRes', {}) {}

export class DebugInfoRerunQueryReq extends LSDStoreReqResMessage('LSD.DebugInfoRerunQueryReq', {
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
}) {}

export class DebugInfoRerunQueryRes extends LSDStoreReqResMessage('LSD.DebugInfoRerunQueryRes', {}) {}

// TODO refactor this to use push/pull semantics
export class MutationBroadcast extends LSDMessage('LSD.Leader.MutationBroadcast', {
  mutationEventEncoded: MutationEvent.AnyEncoded,
}) {}

// TODO refactor this to use push/pull semantics
export class RunMutationReq extends LSDReqResMessage('LSD.Leader.RunMutationReq', {
  mutationEventEncoded: MutationEvent.AnyEncoded.pipe(Schema.omit('id', 'parentId')),
}) {}

export class RunMutationRes extends LSDReqResMessage('LSD.Leader.RunMutationRes', {}) {}

export class MutationLogReq extends LSDReqResMessage('LSD.Leader.MutationLogReq', {}) {}

export class MutationLogRes extends LSDReqResMessage('LSD.Leader.MutationLogRes', {
  mutationLog: Transferable.Uint8Array,
}) {}

export class ReactivityGraphSubscribe extends LSDStoreReqResMessage('LSD.ReactivityGraphSubscribe', {
  includeResults: Schema.Boolean,
}) {}

export class ReactivityGraphUnsubscribe extends LSDStoreReqResMessage('LSD.ReactivityGraphUnsubscribe', {}) {}

export class ReactivityGraphRes extends LSDStoreReqResMessage('LSD.ReactivityGraphRes', {
  reactivityGraph: Schema.Any,
}) {}

export class LiveQueriesSubscribe extends LSDStoreReqResMessage('LSD.LiveQueriesSubscribe', {}) {}

export class LiveQueriesUnsubscribe extends LSDStoreReqResMessage('LSD.LiveQueriesUnsubscribe', {}) {}

export class SerializedLiveQuery extends Schema.Struct({
  _tag: Schema.Literal('computed', 'db', 'graphql'),
  id: Schema.Number,
  label: Schema.String,
  runs: Schema.Number,
  executionTimes: Schema.Array(Schema.Number),
  lastestResult: Schema.Any,
  activeSubscriptions: Schema.Array(
    Schema.Struct({ frames: Schema.Array(Schema.Struct({ name: Schema.String, filePath: Schema.String })) }),
  ),
}) {}

export class LiveQueriesRes extends LSDStoreReqResMessage('LSD.LiveQueriesRes', {
  liveQueries: Schema.Array(SerializedLiveQuery),
}) {}

export class ResetAllDataReq extends LSDReqResMessage('LSD.Leader.ResetAllDataReq', {
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class ResetAllDataRes extends LSDReqResMessage('LSD.Leader.ResetAllDataRes', {}) {}

export class DatabaseFileInfoReq extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoReq', {}) {}

export class DatabaseFileInfo extends Schema.Struct({
  fileSize: Schema.Number,
  persistenceInfo: Schema.Struct({ fileName: Schema.String }, { key: Schema.String, value: Schema.Any }),
}) {}

export class DatabaseFileInfoRes extends LSDReqResMessage('LSD.Leader.DatabaseFileInfoRes', {
  db: DatabaseFileInfo,
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

export class Disconnect extends LSDStoreChannelMessage('LSD.Disconnect', {}) {}

export class Ping extends LSDReqResMessage('LSD.Ping', {}) {}

export class Pong extends LSDReqResMessage('LSD.Pong', {}) {}

export const MessageToAppLeader = Schema.Union(
  SnapshotReq,
  LoadDatabaseFileReq,
  MutationLogReq,
  ResetAllDataReq,
  NetworkStatusSubscribe,
  NetworkStatusUnsubscribe,
  Disconnect,
  RunMutationReq,
  Ping,
  DatabaseFileInfoReq,
  SyncHistorySubscribe,
  SyncHistoryUnsubscribe,
  SyncingInfoReq,
).annotations({ identifier: 'LSD.MessageToAppLeader' })

export type MessageToAppLeader = typeof MessageToAppLeader.Type

export const MessageToAppClientSession = Schema.Union(
  DebugInfoReq,
  DebugInfoHistorySubscribe,
  DebugInfoHistoryUnsubscribe,
  DebugInfoResetReq,
  DebugInfoRerunQueryReq,
  ReactivityGraphSubscribe,
  ReactivityGraphUnsubscribe,
  LiveQueriesSubscribe,
  LiveQueriesUnsubscribe,
  Disconnect,
  // TODO also introduce a ping/pong protocol for the client session <> devtools connection
  // Ping,
).annotations({ identifier: 'LSD.MessageToAppClientSession' })

export type MessageToAppClientSession = typeof MessageToAppClientSession.Type

export const MessageFromAppLeader = Schema.Union(
  SnapshotRes,
  LoadDatabaseFileRes,
  MutationLogRes,
  ResetAllDataRes,
  Disconnect,
  MutationBroadcast,
  NetworkStatusRes,
  RunMutationRes,
  Pong,
  DatabaseFileInfoRes,
  SyncHistoryRes,
  SyncingInfoRes,
).annotations({ identifier: 'LSD.MessageFromAppLeader' })

export type MessageFromAppLeader = typeof MessageFromAppLeader.Type

export const MessageFromAppClientSession = Schema.Union(
  DebugInfoRes,
  DebugInfoHistoryRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  ReactivityGraphRes,
  LiveQueriesRes,
  Disconnect,
  // Pong,
).annotations({ identifier: 'LSD.MessageFromAppClientSession' })

export type MessageFromAppClientSession = typeof MessageFromAppClientSession.Type
