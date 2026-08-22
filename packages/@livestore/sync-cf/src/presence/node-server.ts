import { Effect, Scope, Stream } from '@livestore/utils/effect'
import { PlatformNode, SocketServer } from '@livestore/utils/node'
import type { Socket } from '@livestore/utils/effect'

import { makePresenceServer } from './server.ts'
import { encodePresenceServerMessage } from './server.ts'

export interface NodePresenceServerOptions {
  host?: string
  port?: number
  path?: string
}

/**
 * Starts a Node WebSocket presence server for a single `storeId`.
 *
 * Local-dev / test realization of the ephemeral presence channel. Every
 * connected client shares one room; the server broadcasts each room snapshot
 * to all connected sockets and removes a client when its socket closes.
 *
 * The returned effect is scoped: closing the scope shuts the server down.
 */
export const makeNodePresenceServer = (
  storeId: string,
  options: NodePresenceServerOptions = {},
): Effect.Effect<{ port: number }, never, SocketServer.SocketServer | Scope.Scope> =>
  Effect.gen(function* () {
    const server = yield* makePresenceServer(storeId)

    const sockets = new Set<(message: string) => Effect.Effect<void, never, never>>()

    const broadcast = (message: string) =>
      Effect.forEach(sockets, (send) => send(message), { concurrency: 'unbounded', discard: true })

    yield* Effect.forkScoped(
      server.snapshots.pipe(
        Stream.runForEach((snapshot) =>
          broadcast(JSON.stringify(encodePresenceServerMessage({ _tag: 'PresenceServer.snapshot', snapshot }))),
        ),
      ),
    )

    const socketServer = yield* SocketServer.SocketServer

    yield* socketServer.run((socket: Socket.Socket) =>
      Effect.gen(function* () {
        const write = yield* socket.writer
        const send: (message: string) => Effect.Effect<void, never, never> = (message) =>
          write(message).pipe(Effect.catch(() => Effect.void))
        sockets.add(send)

        yield* Effect.addFinalizer(() => Effect.sync(() => sockets.delete(send)))

        yield* socket.runRaw((message) =>
          Effect.gen(function* () {
            const response = yield* server.handleClientMessage(message)
            yield* write(JSON.stringify(response)).pipe(Effect.catch(() => Effect.void))
          }).pipe(Effect.ignore),
        )
      }),
    )

    const address = socketServer.address
    return {
      port: address._tag === 'TcpAddress' ? address.port : 0,
    }
  }).pipe(Effect.catch(() => Effect.die('presence server failed')))

/**
 * Scoped, self-contained Node presence server: provides its own WebSocket
 * server layer and returns the bound port.
 */
export const makeNodePresenceServerSelfContained = (storeId: string, options: NodePresenceServerOptions = {}) =>
  PlatformNode.NodeSocketServer.makeWebSocket({
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 0,
    path: options.path,
  }).pipe(Effect.flatMap(() => makeNodePresenceServer(storeId, options)))