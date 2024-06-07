import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PullReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PullReq'),
  requestId: Schema.String,
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.optional(Schema.String),
})

export type PullReq = typeof PullReq.Type

export const PullRes = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PullRes'),
  requestId: Schema.String,
  // /** The  */
  // cursor: Schema.String,
  events: Schema.Array(mutationEventSchemaEncodedAny),
  hasMore: Schema.Boolean,
})

export type PullRes = typeof PullRes.Type

export const PushBroadcast = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushBroadcast'),
  requestId: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type PushBroadcast = typeof PushBroadcast.Type

export const PushReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushReq'),
  requestId: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type PushReq = typeof PushReq.Type

export const PushAck = Schema.Struct({
  _tag: Schema.Literal('WSMessage.PushAck'),
  requestId: Schema.String,
  mutationId: Schema.String,
})

export type PushAck = typeof PushAck.Type

export const Error = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Error'),
  requestId: Schema.String,
  message: Schema.String,
})

export const Ping = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Ping'),
  requestId: Schema.Literal('ping'),
})

export type Ping = typeof Ping.Type

export const Pong = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Pong'),
  requestId: Schema.Literal('ping'),
})

export type Pong = typeof Pong.Type

export const Message = Schema.Union(PullReq, PullRes, PushBroadcast, PushReq, PushAck, Error, Ping, Pong)
export type Message = typeof Message.Type
export type MessageEncoded = typeof Message.Encoded

export const IncomingMessage = Schema.Union(PullRes, PushBroadcast, PushAck, Error, Pong)
export type IncomingMessage = typeof IncomingMessage.Type
