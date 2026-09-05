import { BackendIdMismatchError, ServerAheadError, UnknownError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

import { PresenceSnapshot } from '../presence/schema.ts'
import * as SyncMessage from './sync-message-types.ts'

/**
 * WebSocket RPC Schema for LiveStore CF Sync Provider
 *
 * Presence RPCs ride the same socket as eventlog sync: one Durable Object per
 * `storeId` hosts the durable log and fans out ephemeral presence. Presence is
 * never persisted. Isolation inside the DO is by `roomId` (a chat, a board,
 * …); channels are typed topics inside a room.
 *
 * Channels are declared once on the server (`makeDurableObject({ presence: {
 * schemas: { cursor: …, typing: … } } })`) and mirrored by clients. Every
 * update is schema-decoded before fan-out.
 */
export class SyncWsRpc extends RpcGroup.make(
  Rpc.make('SyncWsRpc.Pull', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.Json),
      /** Whether to keep the pull stream alive and wait for more events */
      live: Schema.Boolean,
      ...SyncMessage.PullRequest.fields,
    }),
    success: SyncMessage.PullResponse,
    error: Schema.Union([UnknownError, BackendIdMismatchError]),
    stream: true,
  }),
  Rpc.make('SyncWsRpc.Push', {
    payload: Schema.Struct({
      storeId: Schema.String,
      payload: Schema.optional(Schema.Json),
      ...SyncMessage.PushRequest.fields,
    }),
    success: SyncMessage.PushAck,
    error: Schema.Union([UnknownError, ServerAheadError, BackendIdMismatchError]),
  }),
  Rpc.make('SyncWsRpc.PresenceJoin', {
    payload: Schema.Struct({
      storeId: Schema.String,
      roomId: Schema.String,
      channel: Schema.String,
      clientId: Schema.String,
      name: Schema.optional(Schema.String),
    }),
    success: Schema.Void,
    error: UnknownError,
  }),
  Rpc.make('SyncWsRpc.PresenceUpdate', {
    payload: Schema.Struct({
      storeId: Schema.String,
      roomId: Schema.String,
      channel: Schema.String,
      clientId: Schema.String,
      /** Full accumulated channel state; schema-decoded before fan-out. */
      patch: Schema.Json,
    }),
    success: Schema.Void,
    error: UnknownError,
  }),
  Rpc.make('SyncWsRpc.PresenceLeave', {
    payload: Schema.Struct({
      storeId: Schema.String,
      roomId: Schema.String,
      channel: Schema.String,
      clientId: Schema.String,
    }),
    success: Schema.Void,
    error: UnknownError,
  }),
  Rpc.make('SyncWsRpc.PresenceSnapshots', {
    payload: Schema.Struct({
      storeId: Schema.String,
      roomId: Schema.String,
      channel: Schema.String,
    }),
    success: PresenceSnapshot,
    stream: true,
    error: UnknownError,
  }),
  // Ping <> Pong is handled by DO WS auto-response
) {}
