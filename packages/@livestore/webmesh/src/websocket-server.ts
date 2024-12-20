import type { Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'
import * as WebSocket from 'ws'

import { makeMeshNode } from './node.js'
import { makeWebSocketConnection } from './websocket-connection.js'

export const makeWebSocketServer = ({
  relayNodeName,
}: {
  relayNodeName: string
}): Effect.Effect<WebSocket.WebSocketServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const server = new WebSocket.WebSocketServer({ noServer: true })

    const node = yield* makeMeshNode(relayNodeName)

    const runtime = yield* Effect.runtime<never>()

    // TODO handle node disconnects (i.e. remove respective connection)
    server.on('connection', (socket) => {
      Effect.gen(function* () {
        const { webChannel, from } = yield* makeWebSocketConnection(socket, { _tag: 'relay' })

        yield* node.addConnection({ target: from, connectionChannel: webChannel, replaceIfExists: true })
        yield* Effect.log(`WS Relay ${relayNodeName}: added connection from '${from}'`)

        socket.addEventListener('close', () =>
          Effect.gen(function* () {
            yield* node.removeConnection(from)
            yield* Effect.log(`WS Relay ${relayNodeName}: removed connection from '${from}'`)
          }).pipe(Effect.provide(runtime), Effect.runFork),
        )

        yield* Effect.never
      }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.provide(runtime), Effect.runFork)
    })

    return server
  })
