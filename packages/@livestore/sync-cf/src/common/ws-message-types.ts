import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PullReq = Schema.TaggedStruct('WSMessage.PullReq', {
  requestId: Schema.String,
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.optional(Schema.String),
})

export type PullReq = typeof PullReq.Type

export const PullRes = Schema.TaggedStruct('WSMessage.PullRes', {
  requestId: Schema.String,
  // /** The  */
  // cursor: Schema.String,
  events: Schema.Array(mutationEventSchemaEncodedAny),
  hasMore: Schema.Boolean,
})

export type PullRes = typeof PullRes.Type

export const PushBroadcast = Schema.TaggedStruct('WSMessage.PushBroadcast', {
  requestId: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export type PushBroadcast = typeof PushBroadcast.Type

export const PushReq = Schema.TaggedStruct('WSMessage.PushReq', {
  requestId: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export type PushReq = typeof PushReq.Type

export const PushAck = Schema.TaggedStruct('WSMessage.PushAck', {
  requestId: Schema.String,
  mutationId: Schema.String,
})

export type PushAck = typeof PushAck.Type

export const Error = Schema.TaggedStruct('WSMessage.Error', {
  requestId: Schema.String,
  message: Schema.String,
})

export const Ping = Schema.TaggedStruct('WSMessage.Ping', {
  requestId: Schema.Literal('ping'),
})

export type Ping = typeof Ping.Type

export const Pong = Schema.TaggedStruct('WSMessage.Pong', {
  requestId: Schema.Literal('ping'),
})

export type Pong = typeof Pong.Type

export const AdminResetRoomReq = Schema.TaggedStruct('WSMessage.AdminResetRoomReq', {
  requestId: Schema.String,
  adminSecret: Schema.String,
})

export type AdminResetRoomReq = typeof AdminResetRoomReq.Type

export const AdminResetRoomRes = Schema.TaggedStruct('WSMessage.AdminResetRoomRes', {
  requestId: Schema.String,
})

export type AdminResetRoomRes = typeof AdminResetRoomRes.Type

export const AdminInfoReq = Schema.TaggedStruct('WSMessage.AdminInfoReq', {
  requestId: Schema.String,
  adminSecret: Schema.String,
})

export type AdminInfoReq = typeof AdminInfoReq.Type

export const AdminInfoRes = Schema.TaggedStruct('WSMessage.AdminInfoRes', {
  requestId: Schema.String,
  info: Schema.Struct({
    durableObjectId: Schema.String,
  }),
})

export type AdminInfoRes = typeof AdminInfoRes.Type

export const Message = Schema.Union(
  PullReq,
  PullRes,
  PushBroadcast,
  PushReq,
  PushAck,
  Error,
  Ping,
  Pong,
  AdminResetRoomReq,
  AdminResetRoomRes,
  AdminInfoReq,
  AdminInfoRes,
)
export type Message = typeof Message.Type
export type MessageEncoded = typeof Message.Encoded

export const IncomingMessage = Schema.Union(PullRes, PushBroadcast, PushAck, Error, Pong)
export type IncomingMessage = typeof IncomingMessage.Type
