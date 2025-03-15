import { Schema } from '@livestore/utils/effect'

import { DebugInfo } from '../debug-info.js'
import { EventId } from '../schema/mod.js'
import { PreparedBindValues } from '../util.js'
import { LSDClientSessionChannelMessage, LSDClientSessionReqResMessage } from './devtools-messages-common.js'

export class DebugInfoReq extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoReq', {}) {}

export class DebugInfoRes extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRes', {
  debugInfo: DebugInfo,
}) {}

export class DebugInfoHistorySubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoHistorySubscribe',
  {
    subscriptionId: Schema.String,
  },
) {}

export class DebugInfoHistoryRes extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoHistoryRes', {
  debugInfoHistory: Schema.Array(DebugInfo),
  subscriptionId: Schema.String,
}) {}

export class DebugInfoHistoryUnsubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoHistoryUnsubscribe',
  {
    subscriptionId: Schema.String,
  },
) {}

export class DebugInfoResetReq extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoResetReq', {}) {}

export class DebugInfoResetRes extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoResetRes', {}) {}

export class DebugInfoRerunQueryReq extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRerunQueryReq', {
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
}) {}

export class DebugInfoRerunQueryRes extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoRerunQueryRes',
  {},
) {}

export class SyncHeadSubscribe extends LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadSubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHeadUnsubscribe extends LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadUnsubscribe', {
  subscriptionId: Schema.String,
}) {}
export class SyncHeadRes extends LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadRes', {
  local: EventId.EventId,
  upstream: EventId.EventId,
  subscriptionId: Schema.String,
}) {}

export class ReactivityGraphSubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.ReactivityGraphSubscribe',
  {
    includeResults: Schema.Boolean,
    subscriptionId: Schema.String,
  },
) {}

export class ReactivityGraphUnsubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.ReactivityGraphUnsubscribe',
  {
    subscriptionId: Schema.String,
  },
) {}

export class ReactivityGraphRes extends LSDClientSessionReqResMessage('LSD.ClientSession.ReactivityGraphRes', {
  reactivityGraph: Schema.Any,
  subscriptionId: Schema.String,
}) {}

export class LiveQueriesSubscribe extends LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesSubscribe', {
  subscriptionId: Schema.String,
}) {}

export class LiveQueriesUnsubscribe extends LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesUnsubscribe', {
  subscriptionId: Schema.String,
}) {}

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

export class LiveQueriesRes extends LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesRes', {
  liveQueries: Schema.Array(SerializedLiveQuery),
  subscriptionId: Schema.String,
}) {}

export class Ping extends LSDClientSessionReqResMessage('LSD.ClientSession.Ping', {}) {}

export class Pong extends LSDClientSessionReqResMessage('LSD.ClientSession.Pong', {}) {}

export class Disconnect extends LSDClientSessionChannelMessage('LSD.ClientSession.Disconnect', {}) {}

export const MessageToApp = Schema.Union(
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
  Ping,
  SyncHeadSubscribe,
  SyncHeadUnsubscribe,
).annotations({ identifier: 'LSD.ClientSession.MessageToApp' })

export type MessageToApp = typeof MessageToApp.Type

export const MessageFromApp = Schema.Union(
  DebugInfoRes,
  DebugInfoHistoryRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  ReactivityGraphRes,
  LiveQueriesRes,
  Disconnect,
  Pong,
  SyncHeadRes,
).annotations({ identifier: 'LSD.ClientSession.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
