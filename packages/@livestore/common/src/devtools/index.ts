import { Schema } from '@livestore/utils/effect'
import { type SqliteDsl as __SqliteDsl } from 'effect-db-schema'

import { LiveStoreSchemaSchema } from '../schema/index.js'
import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'

export class SnapshotReq extends Schema.TaggedStruct('LSD.SnapshotReq', {}) {}

export class SnapshotRes extends Schema.TaggedStruct('LSD.SnapshotRes', {
  snapshot: Schema.Uint8Array,
}) {}

export class SerializedSchemaReq extends Schema.TaggedStruct('LSD.SerializedSchemaReq', {}) {}

export class SerializedSchemaRes extends Schema.TaggedStruct('LSD.SerializedSchemaRes', {
  schema: LiveStoreSchemaSchema,
}) {}

export class MutationBroadcast extends Schema.TaggedStruct('LSD.MutationBroadcast', {
  mutationEventEncoded: mutationEventSchemaEncodedAny,
}) {}

export class MutationLogReq extends Schema.TaggedStruct('LSD.MutationLogReq', {}) {}

export class MutationLogRes extends Schema.TaggedStruct('LSD.MutationLogRes', {
  mutationLog: Schema.Uint8Array,
}) {}

export class SubscribeSignalsReq extends Schema.TaggedStruct('LSD.SubscribeSignalsReq', {
  includeResults: Schema.Boolean,
}) {}

export class SubscribeSignalsRes extends Schema.TaggedStruct('LSD.SubscribeSignalsRes', {
  signals: Schema.Any,
}) {}

export class SubscribeLiveQueriesReq extends Schema.TaggedStruct('LSD.SubscribeLiveQueriesReq', {}) {}

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
  liveQueries: Schema.Array(SerializedLiveQuery),
}) {}

export const Message = Schema.Union(
  SnapshotReq,
  SnapshotRes,
  SerializedSchemaReq,
  SerializedSchemaRes,
  MutationBroadcast,
  MutationLogReq,
  MutationLogRes,
  SubscribeSignalsReq,
  SubscribeSignalsRes,
  SubscribeLiveQueriesReq,
  SubscribeLiveQueriesRes,
)

export type Message = typeof Message.Type

export const makeBc = () => new BroadcastChannel('livestore-devtools')
