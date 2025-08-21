import { HttpClient } from '@effect/platform'
import type { Schedule, Scope } from 'effect'
import { Effect, Exit, identity, Schema } from 'effect'

export class WebSocketError extends Schema.TaggedError<WebSocketError>()('WebSocketError', {
  cause: Schema.Defect,
}) {}

// TODO refactor using Effect socket implementation
// https://github.com/Effect-TS/effect/blob/main/packages%2Fexperimental%2Fsrc%2FDevTools%2FClient.ts#L113
// "In a Stream pipeline everything above the pipeThrough is the outgoing (send) messages. Everything below is the incoming (message event) messages."
// https://github.com/Effect-TS/effect/blob/main/packages%2Fplatform%2Fsrc%2FSocket.ts#L451

/**
 * Creates a WebSocket connection and waits for the connection to be established.
 * Automatically closes the connection when the scope is closed.
 */
export const makeWebSocket = ({
  url,
  reconnect,
}: {
  url: string
  reconnect?: Schedule.Schedule<unknown> | false
}): Effect.Effect<globalThis.WebSocket, WebSocketError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    yield* validateUrl(url)

    const socket = yield* Effect.async<globalThis.WebSocket, WebSocketError>((cb, signal) => {
      try {
        const socket = new globalThis.WebSocket(url)

        if (socket.readyState === globalThis.WebSocket.OPEN) {
          cb(Effect.succeed(socket))
          return
        }

        signal.addEventListener('abort', () => {
          socket.close(3000, 'abort signal')
        })

        socket.addEventListener('open', () => cb(Effect.succeed(socket)), { once: true })

        socket.addEventListener(
          'error',
          (event) => {
            cb(Effect.fail(new WebSocketError({ cause: event })))
          },
          { once: true },
        )

        socket.addEventListener(
          'close',
          (event) => {
            // console.log('makeWebSocket:socket:onclose', event)
            return cb(Effect.fail(new WebSocketError({ cause: event })))
          },
          { once: true },
        )

        // console.log('makeWebSocket:socket:waiting for open', url)
      } catch (error) {
        cb(Effect.fail(new WebSocketError({ cause: error })))
      }
    }).pipe(
      Effect.tapErrorTag('WebSocketError', () => tryLogWebsocketConnectError(url)),
      reconnect ? Effect.retry(reconnect) : identity,
    )

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
          return yield* Effect.die(new WebSocketError({ cause: error }))
        }
      }),
    )

    return socket
  })

const validateUrl = (url: string) =>
  Effect.try({
    try: () => new URL(url),
    catch: (error) => new WebSocketError({ cause: error }),
  })

const tryLogWebsocketConnectError = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.get(url)
    const responseBody = yield* res.text
    yield* Effect.logError(`Failed to connect to '${url}' (status: ${res.status}). Error:`, responseBody)
  }).pipe(Effect.ignore)
