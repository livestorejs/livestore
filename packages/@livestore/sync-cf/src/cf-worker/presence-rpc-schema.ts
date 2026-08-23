import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

import { PresenceSnapshot, PresenceState } from '../presence/schema.ts'

/**
 * Presence RPC schema for the Cloudflare Durable Object transport.
 *
 * Each client holds one WebSocket to the presence DO (one DO instance per
 * `storeId` — the partykit "party"). Presence state lives only in DO memory
 * and is broadcast to all connected clients; it is never persisted.
 */
export class PresenceWsRpc extends RpcGroup.make(
  Rpc.make('PresenceWsRpc.Join', {
    payload: Schema.Struct({
      storeId: Schema.String,
      clientId: Schema.String,
      name: Schema.optional(Schema.String),
    }),
    success: Schema.Void,
  }),
  Rpc.make('PresenceWsRpc.Update', {
    payload: Schema.Struct({
      storeId: Schema.String,
      state: PresenceState,
    }),
    success: Schema.Void,
  }),
  Rpc.make('PresenceWsRpc.Leave', {
    payload: Schema.Struct({
      storeId: Schema.String,
      clientId: Schema.String,
    }),
    success: Schema.Void,
  }),
  Rpc.make('PresenceWsRpc.Snapshots', {
    payload: Schema.Struct({
      storeId: Schema.String,
    }),
    success: PresenceSnapshot,
    stream: true,
  }),
) {}
export type PresenceWsRpcI = RpcGroup.Rpcs<typeof PresenceWsRpc>