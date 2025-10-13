import { LiveStoreEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { S2SeqNum } from './types.ts'

export const PullArgs = Schema.Struct({
  storeId: Schema.String,
  s2SeqNum: Schema.Union(S2SeqNum, Schema.Literal('from-start')),
  live: Schema.Boolean,
  payload: Schema.UndefinedOr(Schema.JsonValue),
})

export const PushPayload = Schema.Struct({
  storeId: Schema.String,
  batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
})

export type PullArgs = typeof PullArgs.Type
export type PushPayload = typeof PushPayload.Type

/** Encoded form for query parameter `args` */
export const ArgsSchema = Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(PullArgs))

export const PushResponse = Schema.Struct({ success: Schema.Boolean })
export type PushResponse = typeof PushResponse.Type
