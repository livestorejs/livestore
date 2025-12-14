import { BackendId, SyncBackend } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

/**
 * Common sync message types shared between HTTP and WebSocket transports.
 * These are largely compatible with sync-cf message types for consistency.
 */

export const SyncMetadata = Schema.TaggedStruct('SyncMessage.SyncMetadata', {
  /** ISO date format */
  createdAt: Schema.String,
}).annotations({ title: '@livestore/sync-http:SyncMetadata' })

export type SyncMetadata = typeof SyncMetadata.Type

export const PullRequest = Schema.Struct({
  /** Omitting the cursor will start from the beginning */
  cursor: Schema.Option(
    Schema.Struct({
      backendId: BackendId,
      eventSequenceNumber: EventSequenceNumber.Global.Schema,
    }),
  ),
  /** Whether to keep the connection open for live updates (SSE/WebSocket only) */
  live: Schema.optional(Schema.Boolean),
}).annotations({ title: '@livestore/sync-http:PullRequest' })

export type PullRequest = typeof PullRequest.Type

export const PullResponse = Schema.Struct({
  batch: Schema.Array(
    Schema.Struct({
      eventEncoded: LiveStoreEvent.Global.Encoded,
      metadata: Schema.Option(SyncMetadata),
    }),
  ),
  pageInfo: SyncBackend.PullResPageInfo,
  backendId: BackendId,
}).annotations({ title: '@livestore/sync-http:PullResponse' })

export const emptyPullResponse = (backendId: string) =>
  PullResponse.make({
    batch: [],
    pageInfo: SyncBackend.pageInfoNoMore,
    backendId,
  })

export type PullResponse = typeof PullResponse.Type

export const PushRequest = Schema.Struct({
  batch: Schema.Array(LiveStoreEvent.Global.Encoded),
  backendId: Schema.Option(BackendId),
}).annotations({ title: '@livestore/sync-http:PushRequest' })

export type PushRequest = typeof PushRequest.Type

export const PushAck = Schema.Struct({}).annotations({
  title: '@livestore/sync-http:PushAck',
})

export type PushAck = typeof PushAck.Type

export const Ping = Schema.TaggedStruct('SyncMessage.Ping', {}).annotations({ title: '@livestore/sync-http:Ping' })

export type Ping = typeof Ping.Type

export const Pong = Schema.TaggedStruct('SyncMessage.Pong', {}).annotations({ title: '@livestore/sync-http:Pong' })

export type Pong = typeof Pong.Type

export const BackendToClientMessage = Schema.Union(PullResponse, PushAck, Pong)
export type BackendToClientMessage = typeof BackendToClientMessage.Type

export const ClientToBackendMessage = Schema.Union(PullRequest, PushRequest, Ping)
export type ClientToBackendMessage = typeof ClientToBackendMessage.Type

export const Message = Schema.Union(BackendToClientMessage, ClientToBackendMessage)
export type Message = typeof Message.Type
