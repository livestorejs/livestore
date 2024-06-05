import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PullReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PullReq'),
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.optional(Schema.String),
})

export type PullReq = typeof PullReq.Type

export const PullRes = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PullRes'),
  // /** The  */
  // cursor: Schema.String,
  events: Schema.Array(mutationEventSchemaEncodedAny),
  hasMore: Schema.Boolean,
})

export type PullRes = typeof PullRes.Type

export const PushBroadcast = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushBroadcast'),
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type PushBroadcast = typeof PushBroadcast.Type

export const PushReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushReq'),
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type PushReq = typeof PushReq.Type

export const PushAck = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushAck'),
  mutationId: Schema.String,
})

export type PushAck = typeof PushAck.Type

export const Error = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Error'),
  message: Schema.String,
})

export const Message = Schema.Union(PullReq, PullRes, PushBroadcast, PushReq, PushAck, Error)
export type Message = typeof Message.Type
export type MessageEncoded = typeof Message.Encoded
