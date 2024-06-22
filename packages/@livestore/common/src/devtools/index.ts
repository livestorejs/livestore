import { Schema } from '@livestore/utils/effect'
import { type SqliteDsl as __SqliteDsl } from 'effect-db-schema'

import { LiveStoreSchemaSchema } from '../schema/index.js'
import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'

const requestId = Schema.String

export class SnapshotReq extends Schema.TaggedStruct('LSD.SnapshotReq', {
  requestId,
}) {}

export class SnapshotRes extends Schema.TaggedStruct('LSD.SnapshotRes', {
  requestId,
  snapshot: Schema.Uint8Array,
}) {}

export class SerializedSchemaReq extends Schema.TaggedStruct('LSD.SerializedSchemaReq', {
  requestId,
}) {}

export class SerializedSchemaRes extends Schema.TaggedStruct('LSD.SerializedSchemaRes', {
  requestId,
  schema: LiveStoreSchemaSchema,
}) {}

export class MutationBroadcast extends Schema.TaggedStruct('LSD.MutationBroadcast', {
  requestId,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
}) {}

export class MutationLogReq extends Schema.TaggedStruct('LSD.MutationLogReq', {
  requestId,
}) {}

export class MutationLogRes extends Schema.TaggedStruct('LSD.MutationLogRes', {
  requestId,
  mutationLog: Schema.Uint8Array,
}) {}

export class SubscribeSignalsReq extends Schema.TaggedStruct('LSD.SubscribeSignalsReq', {
  requestId,
  includeResults: Schema.Boolean,
}) {}

export class SubscribeSignalsRes extends Schema.TaggedStruct('LSD.SubscribeSignalsRes', {
  requestId,
  signals: Schema.Any,
}) {}

export class SubscribeLiveQueriesReq extends Schema.TaggedStruct('LSD.SubscribeLiveQueriesReq', {
  requestId,
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

export class SubscribeLiveQueriesRes extends Schema.TaggedStruct('LSD.SubscribeLiveQueriesRes', {
  requestId,
  liveQueries: Schema.Array(SerializedLiveQuery),
}) {}

export class ResetAllDataReq extends Schema.TaggedStruct('LSD.ResetAllDataReq', {
  requestId,
  mode: Schema.Literal('all-data', 'only-app-db'),
}) {}

export class ResetAllDataRes extends Schema.TaggedStruct('LSD.ResetAllDataRes', {
  requestId,
}) {}

export class AppHostReadyReq extends Schema.TaggedStruct('LSD.AppHostReadyReq', {
  requestId,
}) {}
export class AppHostReadyRes extends Schema.TaggedStruct('LSD.AppHostReadyRes', {
  requestId,
}) {}

export class Disconnect extends Schema.TaggedStruct('LSD.Disconnect', {
  requestId,
}) {}

export class SchemaChanged extends Schema.TaggedStruct('LSD.SchemaChanged', {
  requestId,
}) {}

// export const Message = Schema.Union(
//   SnapshotReq,
//   SnapshotRes,
//   SerializedSchemaReq,
//   SerializedSchemaRes,
//   MutationBroadcast,
//   MutationLogReq,
//   MutationLogRes,
//   SubscribeSignalsReq,
//   SubscribeSignalsRes,
//   SubscribeLiveQueriesReq,
//   SubscribeLiveQueriesRes,
//   ResetAllDataReq,
//   ResetAllDataRes,
//   Disconnect,
//   SchemaChanged,
//   AppHostReadyReq,
//   AppHostReadyRes,
// )

// export type Message = typeof Message.Type

export const MessageToAppHost = Schema.Union(
  SnapshotReq,
  SerializedSchemaReq,
  MutationLogReq,
  SubscribeSignalsReq,
  SubscribeLiveQueriesReq,
  ResetAllDataReq,
  AppHostReadyReq,
)

export type MessageToAppHost = typeof MessageToAppHost.Type

export const MessageFromAppHost = Schema.Union(
  SnapshotRes,
  SerializedSchemaRes,
  MutationLogRes,
  SubscribeSignalsRes,
  SubscribeLiveQueriesRes,
  ResetAllDataRes,
  AppHostReadyRes,
  Disconnect,
  SchemaChanged,
  MutationBroadcast,
)

export type MessageFromAppHost = typeof MessageFromAppHost.Type

export const makeBc = () => new BroadcastChannel('livestore-devtools')
