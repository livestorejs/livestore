import { BackendIdMismatchError, ServerAheadError, UnknownError } from '@livestore/common'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

import { PresenceSnapshot, PresenceState } from '../presence/schema.ts'
import * as SyncMessage from './sync-message-types.ts'

/**
 * WebSocket RPC Schema for LiveStore CF Sync Provider
 *
 * This defines the RPC endpoints available over WebSocket transport.
 * Unlike HTTP transport which uses request/response patterns for each operation,
 * WebSocket transport maintains a persistent connection and uses streaming responses.
 *
 * Presence RPCs ride the same socket + party as the eventlog sync: one DO per
 * `storeId` hosts both the durable log and the ephemeral presence room
 * (partykit-style single party). Presence state is never persisted.
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
      clientId: Schema.String,
      name: Schema.optional(Schema.String),
    }),
    success: Schema.Void,
  }),
  Rpc.make('SyncWsRpc.PresenceUpdate', {
    payload: Schema.Struct({
      storeId: Schema.String,
      state: PresenceState,
    }),
    success: Schema.Void,
  }),
  Rpc.make('SyncWsRpc.PresenceLeave', {
    payload: Schema.Struct({
      storeId: Schema.String,
      clientId: Schema.String,
    }),
    success: Schema.Void,
  }),
  Rpc.make('SyncWsRpc.PresenceSnapshots', {
    payload: Schema.Struct({
      storeId: Schema.String,
    }),
    success: PresenceSnapshot,
    stream: true,
  }),
  // Ping <> Pong is handled by DO WS auto-response
  // TODO add admin RPCs
) {}
