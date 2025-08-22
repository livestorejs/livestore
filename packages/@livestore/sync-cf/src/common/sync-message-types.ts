import { SyncBackend, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

/**
 * Common sync message types shared between different transport modes (WS, HTTP, RPC)
 *
 * These are the canonical message definitions used across all transport implementations.
 */

export const SyncMetadata = Schema.TaggedStruct('SyncMessage.SyncMetadata', {
  /** ISO date format */
  createdAt: Schema.String,
}).annotations({ title: '@livestore/sync-cf:SyncMetadata' })

export type SyncMetadata = typeof SyncMetadata.Type

export const PullRequest = Schema.Struct({
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.optional(EventSequenceNumber.GlobalEventSequenceNumber),
}).annotations({ title: '@livestore/sync-cf:PullRequest' })

export type PullRequest = typeof PullRequest.Type

export const PullResponse = Schema.Struct({
  batch: Schema.Array(
    Schema.Struct({
      eventEncoded: LiveStoreEvent.AnyEncodedGlobal,
      metadata: Schema.Option(SyncMetadata),
    }),
  ),
  pageInfo: SyncBackend.PullResPageInfo,
}).annotations({ title: '@livestore/sync-cf:PullResponse' })

export type PullResponse = typeof PullResponse.Type

export const PushRequest = Schema.Struct({
  batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
}).annotations({ title: '@livestore/sync-cf:PushRequest' })

export type PushRequest = typeof PushRequest.Type

export const PushAck = Schema.Struct({}).annotations({
  title: '@livestore/sync-cf:PushAck',
})

export type PushAck = typeof PushAck.Type

export const InvalidParentEventNumber = Schema.TaggedStruct('SyncMessage.SyncError.InvalidParentEventNumber', {
  expected: EventSequenceNumber.GlobalEventSequenceNumber,
  received: EventSequenceNumber.GlobalEventSequenceNumber,
}).annotations({ title: '@livestore/sync-cf:InvalidParentEventNumber' })
export type InvalidParentEventNumber = typeof InvalidParentEventNumber.Type

export class SyncError extends Schema.TaggedError<SyncError>()(
  'SyncMessage.SyncError',
  {
    cause: Schema.Union(UnexpectedError, InvalidParentEventNumber),
    storeId: Schema.optional(Schema.String),
  },
  { title: '@livestore/sync-cf:SyncError' },
) {}

export const Ping = Schema.TaggedStruct('SyncMessage.Ping', {}).annotations({ title: '@livestore/sync-cf:Ping' })

export type Ping = typeof Ping.Type

export const Pong = Schema.TaggedStruct('SyncMessage.Pong', {}).annotations({ title: '@livestore/sync-cf:Pong' })

export type Pong = typeof Pong.Type

// Admin operations
export const AdminResetRoomRequest = Schema.TaggedStruct('SyncMessage.AdminResetRoomRequest', {
  adminSecret: Schema.String,
}).annotations({ title: '@livestore/sync-cf:AdminResetRoomRequest' })

export type AdminResetRoomRequest = typeof AdminResetRoomRequest.Type

export const AdminResetRoomResponse = Schema.TaggedStruct('SyncMessage.AdminResetRoomResponse', {}).annotations({
  title: '@livestore/sync-cf:AdminResetRoomResponse',
})

export type AdminResetRoomResponse = typeof AdminResetRoomResponse.Type

export const AdminInfoRequest = Schema.TaggedStruct('SyncMessage.AdminInfoRequest', {
  adminSecret: Schema.String,
}).annotations({ title: '@livestore/sync-cf:AdminInfoRequest' })

export type AdminInfoRequest = typeof AdminInfoRequest.Type

export const AdminInfoResponse = Schema.TaggedStruct('SyncMessage.AdminInfoResponse', {
  info: Schema.Struct({
    durableObjectId: Schema.String,
  }),
}).annotations({ title: '@livestore/sync-cf:AdminInfoResponse' })

export type AdminInfoResponse = typeof AdminInfoResponse.Type

export const BackendToClientMessage = Schema.Union(
  PullResponse,
  PushAck,
  SyncError,
  Pong,
  AdminResetRoomResponse,
  AdminInfoResponse,
)
export type BackendToClientMessage = typeof BackendToClientMessage.Type

export const ClientToBackendMessage = Schema.Union(
  PullRequest,
  PushRequest,
  Ping,
  AdminResetRoomRequest,
  AdminInfoRequest,
)
export type ClientToBackendMessage = typeof ClientToBackendMessage.Type

export const Message = Schema.Union(BackendToClientMessage, ClientToBackendMessage)
export type Message = typeof Message.Type
