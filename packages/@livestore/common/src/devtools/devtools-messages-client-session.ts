import { Schema } from '@livestore/utils/effect'

import { DebugInfo } from '../debug-info.ts'
import { EventSequenceNumber } from '../schema/mod.ts'
import { PreparedBindValues } from '../util.ts'
import { LSDClientSessionChannelMessage, LSDClientSessionReqResMessage } from './devtools-messages-common.ts'

export const DebugInfoReq = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoReq', {})

export const DebugInfoRes = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRes', {
  debugInfo: DebugInfo,
})

export const DebugInfoHistorySubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoHistorySubscribe', {
  subscriptionId: Schema.String,
})

export const DebugInfoHistoryRes = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoHistoryRes', {
  debugInfoHistory: Schema.Array(DebugInfo),
  subscriptionId: Schema.String,
})

export const DebugInfoHistoryUnsubscribe = LSDClientSessionReqResMessage(
  'LSD.ClientSession.DebugInfoHistoryUnsubscribe',
  {
    subscriptionId: Schema.String,
  },
)

export const DebugInfoResetReq = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoResetReq', {})

export const DebugInfoResetRes = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoResetRes', {})

export const DebugInfoRerunQueryReq = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRerunQueryReq', {
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  queriedTables: Schema.ReadonlySet(Schema.String),
})

export const DebugInfoRerunQueryRes = LSDClientSessionReqResMessage('LSD.ClientSession.DebugInfoRerunQueryRes', {})

export const SyncHeadSubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadSubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHeadUnsubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadUnsubscribe', {
  subscriptionId: Schema.String,
})
export const SyncHeadRes = LSDClientSessionReqResMessage('LSD.ClientSession.SyncHeadRes', {
  local: EventSequenceNumber.Client.Composite,
  upstream: EventSequenceNumber.Client.Composite,
  subscriptionId: Schema.String,
})

export const ReactivityGraphSubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.ReactivityGraphSubscribe', {
  includeResults: Schema.Boolean,
  subscriptionId: Schema.String,
})

export const ReactivityGraphUnsubscribe = LSDClientSessionReqResMessage(
  'LSD.ClientSession.ReactivityGraphUnsubscribe',
  {
    subscriptionId: Schema.String,
  },
)

export const ReactivityGraphRes = LSDClientSessionReqResMessage('LSD.ClientSession.ReactivityGraphRes', {
  reactivityGraph: Schema.Any,
  subscriptionId: Schema.String,
})

export const LiveQueriesSubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesSubscribe', {
  subscriptionId: Schema.String,
})

export const LiveQueriesUnsubscribe = LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesUnsubscribe', {
  subscriptionId: Schema.String,
})

export const SerializedLiveQuery = Schema.Struct({
  _tag: Schema.Literals(['computed', 'db', 'graphql', 'signal']),
  id: Schema.Finite,
  label: Schema.String,
  hash: Schema.String,
  runs: Schema.Finite,
  executionTimes: Schema.Array(Schema.Finite),
  lastestResult: Schema.Any,
  activeSubscriptions: Schema.Array(
    Schema.Struct({ frames: Schema.Array(Schema.Struct({ name: Schema.String, filePath: Schema.String })) }),
  ),
})

export const LiveQueriesRes = LSDClientSessionReqResMessage('LSD.ClientSession.LiveQueriesRes', {
  liveQueries: Schema.Array(SerializedLiveQuery),
  subscriptionId: Schema.String,
})

export const Ping = LSDClientSessionReqResMessage('LSD.ClientSession.Ping', {
  devtoolsProtocolVersion: Schema.optional(Schema.Finite),
})

export const Pong = LSDClientSessionReqResMessage('LSD.ClientSession.Pong', {
  devtoolsProtocolVersion: Schema.optional(Schema.Finite),
})

/**
 * Sent by the app when the DevTools protocol isn't compatible.
 * Contains package versions for display and protocol versions for the actual compatibility decision.
 */
export const VersionMismatch = LSDClientSessionReqResMessage('LSD.ClientSession.VersionMismatch', {
  /** The version running in the app */
  appVersion: Schema.String,
  /** The version that was sent by DevTools (that caused the mismatch) */
  receivedVersion: Schema.String,
  appDevtoolsProtocolVersion: Schema.Finite,
  receivedDevtoolsProtocolVersion: Schema.optional(Schema.Finite),
})

export const Disconnect = LSDClientSessionChannelMessage('LSD.ClientSession.Disconnect', {})

export const MessageToApp = Schema.Union([
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
]).annotate({ identifier: 'LSD.ClientSession.MessageToApp' })

export type MessageToApp = typeof MessageToApp.Type

export const MessageFromApp = Schema.Union([
  DebugInfoRes,
  DebugInfoHistoryRes,
  DebugInfoResetRes,
  DebugInfoRerunQueryRes,
  ReactivityGraphRes,
  LiveQueriesRes,
  Disconnect,
  Pong,
  VersionMismatch,
  SyncHeadRes,
]).annotate({ identifier: 'LSD.ClientSession.MessageFromApp' })

export type MessageFromApp = typeof MessageFromApp.Type
