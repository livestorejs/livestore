import { UnexpectedError } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Effect, FiberSet } from '@livestore/utils/effect'
import * as WebSocket from 'ws'

import { makeMeshNode } from './node.js'
import { makeWebSocketEdge } from './websocket-edge.js'

export const makeWebSocketServer = ({
  relayNodeName,
}: {
  relayNodeName: string
}): Effect.Effect<WebSocket.WebSocketServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const server = new WebSocket.WebSocketServer({ noServer: true })

    yield* Effect.addFinalizer(() =>
      Effect.async<void, UnexpectedError>((cb) => {
        server.close((cause) => {
          if (cause) {
            cb(Effect.fail(UnexpectedError.make({ cause })))
          } else {
            server.removeAllListeners()
            server.clients.forEach((client) => client.terminate())
            cb(Effect.succeed(undefined))
          }
        })
      }).pipe(Effect.orDie),
    )

    const node = yield* makeMeshNode(relayNodeName)

    const runtime = yield* Effect.runtime<never>()

    const fiberSet = yield* FiberSet.make()

    // TODO handle node disconnects (i.e. remove respective connection)
    server.on('connection', (socket) => {
      Effect.gen(function* () {
        const { webChannel, from } = yield* makeWebSocketEdge(socket, { _tag: 'relay' })

        yield* node.addEdge({ target: from, edgeChannel: webChannel, replaceIfExists: true })
        yield* Effect.log(`WS Relay ${relayNodeName}: added edge from '${from}'`)

        socket.addEventListener('close', () =>
          Effect.gen(function* () {
            yield* node.removeEdge(from)
            yield* Effect.log(`WS Relay ${relayNodeName}: removed edge from '${from}'`)
          }).pipe(Effect.provide(runtime), Effect.tapCauseLogPretty, Effect.runFork),
        )

        yield* Effect.never
      }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.provide(runtime), FiberSet.run(fiberSet), Effect.runFork)
    })

    return server
  })
