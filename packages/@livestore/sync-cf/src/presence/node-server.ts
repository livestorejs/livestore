import { Effect, Layer, RpcSerialization, RpcServer, Scope } from '@livestore/utils/effect'
import { PlatformNode, SocketServer } from '@livestore/utils/node'

import { PresenceWsRpc } from '../cf-worker/presence-rpc-schema.ts'
import { makePresenceRoom } from './room.ts'

export interface NodePresenceServerOptions {
  host?: string
  port?: number
  path?: string
}

/**
 * Node WebSocket presence server for a single `storeId`, served over Effect's
 * RPC + SocketServer stack (the same transport the Cloudflare DO uses).
 *
 * Every connected client shares one in-memory room; the server streams
 * full-room snapshots and applies `Join`/`Update`/`Leave`. Presence is
 * ephemeral — never persisted.
 *
 * The returned effect requires a `Scope` and runs until that scope closes;
 * the caller keeps it alive (e.g. `Effect.never` inside `Effect.scoped`).
 */
export const makeNodePresenceServer = (
  storeId: string,
  _options: NodePresenceServerOptions = {},
): Effect.Effect<{ port: number }, never, SocketServer.SocketServer | Scope.Scope> =>
  Effect.gen(function* () {
    const room = yield* makePresenceRoom(storeId)

    const handlersLayer = PresenceWsRpc.toLayer({
      'PresenceWsRpc.Join': ({ clientId, name }) => room.join(clientId, name),
      'PresenceWsRpc.Update': ({ state }) => room.update(state),
      'PresenceWsRpc.Leave': ({ clientId }) => room.leave(clientId),
      'PresenceWsRpc.Snapshots': () => room.snapshots,
    })

    const ServerLive = RpcServer.layer(PresenceWsRpc)
      .pipe(Layer.provide(handlersLayer))
      .pipe(Layer.provide(RpcServer.layerProtocolSocketServer))
      .pipe(Layer.provide(RpcSerialization.layerJson))

    yield* Layer.launch(ServerLive)

    const socketServer = yield* SocketServer.SocketServer
    const address = socketServer.address
    return {
      port: address._tag === 'TcpAddress' ? address.port : 0,
    }
  })

/**
 * Self-contained Node presence server: provides its own WebSocket server
 * layer and returns the bound port.
 *
 * The returned effect requires a `Scope` and runs until that scope closes;
 * the caller keeps it alive (e.g. `Effect.never` inside `Effect.scoped`).
 */
export const makeNodePresenceServerSelfContained = (storeId: string, options: NodePresenceServerOptions = {}) =>
  Effect.gen(function* () {
    const layer = Layer.effect(
      SocketServer.SocketServer,
      PlatformNode.NodeSocketServer.makeWebSocket({
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 0,
        path: options.path,
      }),
    )
    return yield* makeNodePresenceServer(storeId, options).pipe(Effect.provide(layer))
  })