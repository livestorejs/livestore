/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import { type CfTypes, setupDurableObjectWebSocketRpc } from '@livestore/common-cf'
import { CfDeclare } from '@livestore/common-cf/declare'
import { Effect, Layer, RpcServer, Stream } from '@livestore/utils/effect'

import { makePresenceRoom, type PresenceRoom } from '../presence/room.ts'
import { PresenceWsRpc } from './presence-rpc-schema.ts'

const WebSocketPair = CfDeclare.WebSocketPair

export interface PresenceDoEnv {}

/**
 * A Cloudflare Durable Object serving the ephemeral presence channel for a
 * single `storeId`.
 *
 * One DO instance per storeId is the partykit "party": it holds the in-memory
 * presence room (never persisted) and broadcasts full-room snapshots to every
 * connected WebSocket. Clients connect via `@livestore/sync-cf/presence/client`
 * (or the WS RPC client) and the DO streams snapshots over the same socket.
 */
export class PresenceDurableObject extends DurableObject<PresenceDoEnv, unknown> {
  override __DURABLE_OBJECT_BRAND = 'PresenceDurableObject' as never
  private readonly rooms = new Map<string, PresenceRoom>()

  constructor(state: DurableObjectState, env: PresenceDoEnv) {
    super(state, env)

    this.ctx = state

    const self = this

    const handlersLayer = PresenceWsRpc.toLayer({
      'PresenceWsRpc.Join': ({ storeId, clientId, name }) =>
        Effect.gen(function* () {
          const room = yield* self.getRoom(storeId)
          yield* room.join(clientId, name)
        }),
      'PresenceWsRpc.Update': ({ storeId, state }) =>
        Effect.gen(function* () {
          const room = yield* self.getRoom(storeId)
          yield* room.update(state)
        }),
      'PresenceWsRpc.Leave': ({ storeId, clientId }) =>
        Effect.gen(function* () {
          const room = yield* self.getRoom(storeId)
          yield* room.leave(clientId)
        }),
      'PresenceWsRpc.Snapshots': ({ storeId }) =>
        Effect.gen(function* () {
          const room = yield* self.getRoom(storeId)
          return room.snapshots
        }).pipe(Stream.unwrap),
    })

    const ServerLive = RpcServer.layer(PresenceWsRpc).pipe(Layer.provide(handlersLayer))

    setupDurableObjectWebSocketRpc({
      doSelf: this as unknown as CfTypes.DurableObject,
      rpcLayer: ServerLive,
      webSocketMode: 'hibernate',
    })
  }

  private getRoom(storeId: string): Effect.Effect<PresenceRoom, never, never> {
    const existing = this.rooms.get(storeId)
    if (existing !== undefined) return Effect.succeed(existing)
    return makePresenceRoom(storeId).pipe(
      Effect.tap((room) => Effect.sync(() => this.rooms.set(storeId, room))),
    )
  }

  override async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === undefined || upgradeHeader !== 'websocket') {
      return new Response('Presence Durable Object expected Upgrade: websocket', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }
}