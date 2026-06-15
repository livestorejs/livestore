export * from 'effect/unstable/rpc/RpcClient'

import { Cause, Deferred, Effect, Latch, Layer, Result, Schedule, type Scope } from 'effect'
import { constVoid } from 'effect/Function'
import { RpcClient, RpcClientError, RpcSerialization } from 'effect/unstable/rpc'
import { Protocol } from 'effect/unstable/rpc/RpcClient'
import { RpcClientDefect } from 'effect/unstable/rpc/RpcClientError'
import { constPing, type FromServerEncoded } from 'effect/unstable/rpc/RpcMessage'
import { Socket } from 'effect/unstable/socket'

import * as SubscriptionRef from './SubscriptionRef.ts'

export interface SocketPinger {
  readonly timeout: Effect.Effect<void>
  readonly reset: () => void
  readonly onPong: () => void
  readonly ping: Effect.Effect<void, RpcClientError.RpcClientError>
}

export const layerProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown, Socket.SocketError> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | Socket.Socket> =>
  Layer.effect(Protocol, makeProtocolSocketWithIsConnected(options))

export const makeProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown, Socket.SocketError> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
}): Effect.Effect<Protocol['Service'], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket> =>
  Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const socket = yield* Socket.Socket
      const serialization = yield* RpcSerialization.RpcSerialization
      const requestClientMap = new Map<string, number>()

      const write = yield* socket.writer
      let parser = serialization.makeUnsafe()
      let currentError: RpcClientError.RpcClientError | undefined

      const pinger = yield* makeSocketPinger(Effect.orDie(write(parser.encode(constPing)!)))

      const onOpen = Effect.suspend(() => {
        currentError = undefined
        return SubscriptionRef.set(options.isConnected, true)
      })

      const broadcast = (response: FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response))

      yield* Effect.suspend(() => {
        parser = serialization.makeUnsafe()
        pinger.reset()

        return socket
          .runRaw(
            (message) => {
              try {
                const responses = parser.decode(message) as Array<FromServerEncoded>
                if (responses.length === 0) return

                let i = 0
                return Effect.whileLoop({
                  while: () => i < responses.length,
                  body: () => {
                    const response = responses[i++]!

                    if (response._tag === 'Pong') {
                      pinger.onPong()
                      return Effect.void
                    }

                    if ('requestId' in response) {
                      const clientId = requestClientMap.get(response.requestId)
                      if (clientId !== undefined) {
                        if (response._tag === 'Exit') {
                          requestClientMap.delete(response.requestId)
                        }
                        return writeResponse(clientId, response)
                      }
                    }

                    return broadcast(response)
                  },
                  step: constVoid,
                })
              } catch (defect) {
                return broadcast({
                  _tag: 'ClientProtocolError',
                  error: new RpcClientError.RpcClientError({
                    reason: new RpcClientDefect({
                      message: 'Error decoding message',
                      cause: defect,
                    }),
                  }),
                })
              }
            },
            { onOpen },
          )
          .pipe(
            Effect.raceFirst(
              Effect.flatMap(pinger.timeout, () =>
                Effect.fail(
                  new Socket.SocketError({
                    reason: new Socket.SocketOpenError({
                      kind: 'Timeout',
                      cause: new Error('ping timeout'),
                    }),
                  }),
                ),
              ),
            ),
          )
      }).pipe(
        Effect.flatMap(() =>
          Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })),
        ),
        Effect.ensuring(SubscriptionRef.set(options.isConnected, false)),
        Effect.tapCause((cause) => {
          const error = Cause.findError(cause)
          const hasError = Result.isSuccess(error)

          if (
            options.retryTransientErrors !== undefined &&
            hasError === true &&
            (error.success as Socket.SocketError).reason._tag === 'SocketOpenError'
          ) {
            return Effect.void
          }

          currentError = new RpcClientError.RpcClientError({
            reason:
              hasError === true
                ? (error.success as Socket.SocketError).reason
                : new RpcClientDefect({
                    message: 'Unknown socket error',
                    cause: Cause.squash(cause),
                  }),
          })

          return broadcast({
            _tag: 'ClientProtocolError',
            error: currentError,
          })
        }),
        Effect.retry(options.retryTransientErrors ?? defaultRetryPolicy),
        Effect.annotateLogs({
          module: 'RpcClient',
          method: 'makeProtocolSocketWithIsConnected',
        }),
        Effect.interruptible,
        Effect.forkScoped,
      )

      return {
        send(clientId, request) {
          if (currentError !== undefined) {
            return Effect.fail(currentError)
          }

          if (request._tag === 'Request') {
            requestClientMap.set(request.id, clientId)
          }

          const encoded = parser.encode(request)
          if (encoded === undefined) return Effect.void

          return Effect.orDie(write(encoded))
        },
        supportsAck: true,
        supportsTransferables: false,
        pinger,
      }
    }),
  )

export const SocketPinger = Effect.map(RpcClient.Protocol, (protocol) => {
  if (hasSocketPinger(protocol) === true) return protocol.pinger

  throw new Error('RpcClient.Protocol does not expose a SocketPinger')
})

const makeSocketPinger = Effect.fnUntraced(function* (writePing: Effect.Effect<void, RpcClientError.RpcClientError>) {
  const manualPingDeferreds = new Set<Deferred.Deferred<void>>()

  let receivedPong = true
  const latch = Latch.makeUnsafe()
  const reset = () => {
    receivedPong = true
    latch.closeUnsafe()
  }
  const onPong = () => {
    receivedPong = true
    for (const deferred of manualPingDeferreds) {
      Deferred.doneUnsafe(deferred, Effect.void)
    }
    manualPingDeferreds.clear()
  }

  yield* Effect.suspend(() => {
    if (receivedPong === false) return latch.open
    receivedPong = false
    return writePing
  }).pipe(Effect.delay('5 seconds'), Effect.ignore, Effect.forever, Effect.interruptible, Effect.forkScoped)

  const ping = Effect.gen(function* () {
    const deferred = yield* Deferred.make<void>()
    manualPingDeferreds.add(deferred)
    yield* writePing
    yield* Deferred.await(deferred).pipe(Effect.ensuring(Effect.sync(() => manualPingDeferreds.delete(deferred))))
  })

  return { timeout: latch.await, reset, onPong, ping } satisfies SocketPinger
})

const defaultRetryPolicy = Schedule.exponential(500, 1.5).pipe(Schedule.either(Schedule.spaced(5000)))

const hasSocketPinger = (
  protocol: Protocol['Service'],
): protocol is Protocol['Service'] & { readonly pinger: SocketPinger } => 'pinger' in protocol
