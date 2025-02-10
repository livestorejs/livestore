import { Schema } from '@livestore/utils/effect'

import { DebugInfo } from '../debug-info.js'
import { PreparedBindValues } from '../util.js'
import { LSDClientSessionChannelMessage, LSDClientSessionReqResMessage } from './devtools-messages-common.js'

export class DebugInfoReq extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoReq', {}) {}

export class DebugInfoRes extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRes', {
  debugInfo: DebugInfo,
}) {}

export class DebugInfoHistorySubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoHistorySubscribe',
  {},
) {}

export class DebugInfoHistoryRes extends LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoHistoryRes', {
  debugInfoHistory: Schema.Array(DebugInfo),
}) {}

export class DebugInfoHistoryUnsubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoHistoryUnsubscribe',
  {},
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

export class ReactivityGraphSubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.ReactivityGraphSubscribe',
  {
    includeResults: Schema.Boolean,
  },
) {}

export class ReactivityGraphUnsubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.ReactivityGraphUnsubscribe',
  {},
) {}

export class ReactivityGraphRes extends LSDClientSessionReqResMessage('LSD.ClientSession.ReactivityGraphRes', {
  reactivityGraph: Schema.Any,
}) {}

export class LiveQueriesSubscribe extends LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesSubscribe', {}) {}

export class LiveQueriesUnsubscribe extends LSDClientSessionReqResMessage(
  'LSD.ClientSession.LiveQueriesUnsubscribe',
  {},
) {}

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
).annotations({ identifier: 'LSD.ClientSession.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
