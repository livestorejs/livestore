import type { CfTypes } from '@livestore/common-cf'
import type { Schedule, Scope } from '@livestore/utils/effect'
import { Effect, Exit, identity, WebSocket } from '@livestore/utils/effect'

// TODO refactor using Effect socket implementation
// https://github.com/Effect-TS/effect/blob/main/packages%2Fexperimental%2Fsrc%2FDevTools%2FClient.ts#L113
// "In a Stream pipeline everything above the pipeThrough is the outgoing (send) messages. Everything below is the incoming (message event) messages."
// https://github.com/Effect-TS/effect/blob/main/packages%2Fplatform%2Fsrc%2FSocket.ts#L451

/**
 * Creates a WebSocket connection and waits for the connection to be established.
 * Automatically closes the connection when the scope is closed.
 */
export const makeWebSocket = ({
  // do,
  reconnect,
  url,
  durableObject,
}: {
  /** CF Sync Backend DO with `/sync` endpoint */
  durableObject: CfTypes.DurableObjectStub
  url: URL
  reconnect?: Schedule.Schedule<unknown> | false
}): Effect.Effect<CfTypes.WebSocket, WebSocket.WebSocketError, Scope.Scope> =>
  Effect.gen(function* () {
    // yield* validateUrl(url)

    const socket = yield* Effect.tryPromise({
      try: () =>
        durableObject.fetch(url, { headers: { Upgrade: 'websocket' } }).then((res: any) => {
          if (!res.webSocket) {
            throw new Error('WebSocket upgrade failed')
          }
          return res.webSocket as CfTypes.WebSocket
        }),
      catch: (cause) => new WebSocket.WebSocketError({ cause }),
    }).pipe(reconnect ? Effect.retry(reconnect) : identity, Effect.withSpan('make-websocket-durable-object'))

    socket.accept()

    /**
     * Common WebSocket close codes: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
     *   1000: Normal closure
     *   1001: Endpoint is going away, a server is terminating the connection because it has received a request that indicates the client is ending the connection.
     *   1002: Protocol error, a server is terminating the connection because it has received data on the connection that was not consistent with the type of the connection.
     *   1011: Internal server error, a server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.
     *
     * For reference, here are the valid WebSocket close code ranges:
     *   1000-1999: Reserved for protocol usage
     *   2000-2999: Reserved for WebSocket extensions
     *   3000-3999: Available for libraries and frameworks
     *   4000-4999: Available for applications
     */
    yield* Effect.addFinalizer(
      Effect.fn(function* (exit) {
        try {
          if (Exit.isFailure(exit)) {
            socket.close(3000)
          } else {
            socket.close(1000)
          }
        } catch (error) {
          return yield* Effect.die(new WebSocket.WebSocketError({ cause: error }))
        }
      }),
    )

    return socket
  })
