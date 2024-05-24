import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const InitReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.InitReq'),
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.optional(Schema.String),
})

export type InitReq = typeof InitReq.Type

export const InitRes = Schema.Struct({
  _tag: Schema.Literal('WSMessage.InitRes'),
  // /** The  */
  // cursor: Schema.String,
  events: Schema.Array(mutationEventSchemaEncodedAny),
  hasMore: Schema.Boolean,
})

export type InitRes = typeof InitRes.Type

export const Broadcast = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Broadcast'),
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type Broadcast = typeof Broadcast.Type

export const BroadcastReq = Schema.Struct({
  _tag: Schema.Literal('WSMessage.BroadcastReq'),
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type BroadcastReq = typeof BroadcastReq.Type

export const BroadcastAck = Schema.Struct({
  _tag: Schema.Literal('WSMessage.BroadcastAck'),
  mutationId: Schema.String,
})

export type BroadcastAck = typeof BroadcastAck.Type

export const Error = Schema.Struct({
  _tag: Schema.Literal('WSMessage.Error'),
  message: Schema.String,
})

export const Message = Schema.Union(InitReq, InitRes, Broadcast, BroadcastReq, BroadcastAck, Error)
export type Message = typeof Message.Type
export type MessageEncoded = typeof Message.Encoded
