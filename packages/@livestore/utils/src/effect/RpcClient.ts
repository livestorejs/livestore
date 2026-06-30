export * from 'effect/unstable/rpc/RpcClient'

import { Cause, Deferred, Effect, Function, Latch, Layer, References, Result, Schedule, type Scope } from 'effect'
import { RpcClient, RpcClientError, RpcSerialization } from 'effect/unstable/rpc'
import { Protocol } from 'effect/unstable/rpc/RpcClient'
import { constPing, type FromServerEncoded } from 'effect/unstable/rpc/RpcMessage'
import { Socket } from 'effect/unstable/socket'

import * as SubscriptionRef from './SubscriptionRef.ts'

// This is based on `makeProtocolSocket` / `layerProtocolSocket` from `@effect/rpc` in order to:
// - Add a `isConnected` subscription ref to track the connection state
// - Add a ping schedule to the socket
// - Add a retry schedule to the socket

export const layerProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
  readonly pingSchedule?: Schedule.Schedule<unknown> | undefined
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | Socket.Socket> =>
  Layer.effect(Protocol, makeProtocolSocketWithIsConnected(options))

export const makeProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown> | undefined
  // CHANGED: add isConnected subscription ref
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
  // CHANGED: add ping schedule
  readonly pingSchedule?: Schedule.Schedule<unknown> | undefined
}): Effect.Effect<Protocol['Service'], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket> =>
  Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const socket = yield* Socket.Socket
      const serialization = yield* RpcSerialization.RpcSerialization
      const requestClientMap = new Map<string, number>()

      const write = yield* socket.writer
      let parser = serialization.makeUnsafe()

      const pinger = yield* makePinger(write(parser.encode(constPing)!), options?.pingSchedule)
      let currentError: RpcClientError.RpcClientError | undefined

      const markConnected = SubscriptionRef.set(options.isConnected, true)
      const broadcast = (response: FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response))

      yield* Effect.suspend(() => {
        // We rely on the heartbeat watchdog while streaming arbitrarily long payloads.
        // Reset the timer as soon as _any_ frame arrives so that large batches which
        // don't contain explicit `Pong` messages don't trigger the open-timeout defect.
        // (The actual pong handler still calls `onPong()` to resolve manual pings.)
        // CHANGED: don't reset parser on every message
        // parser = serialization.makeUnsafe()
        currentError = undefined
        pinger.reset()
        return socket
          .runRaw((message) => {
            try {
              const responses = parser.decode(message) as Array<FromServerEncoded>
              if (responses.length === 0) return
              let i = 0
              return Effect.whileLoop({
                while: () => i < responses.length,
                body: () => {
                  const response = responses[i++]!
                  // Keep extending the watchdog for each data frame to avoid
                  // disconnecting mid-stream when the server is busy sending batches.
                  pinger.reset()
                  if (response._tag === 'Pong') {
                    pinger.onPong()
                    return markConnected
                  }
                  if ('requestId' in response) {
                    const clientId = requestClientMap.get(response.requestId)
                    if (clientId !== undefined) {
                      if (response._tag === 'Exit') {
                        requestClientMap.delete(response.requestId)
                      }
                      return markConnected.pipe(Effect.andThen(writeResponse(clientId, response)))
                    }
                  }
                  return markConnected.pipe(Effect.andThen(broadcast(response)))
                },
                step: Function.constVoid,
              })
            } catch (defect) {
              return broadcast({
                _tag: 'ClientProtocolError',
                error: new RpcClientError.RpcClientError({
                  reason: new RpcClientError.RpcClientDefect({
                    message: 'Error decoding message',
                    cause: defect,
                  }),
                }),
              })
            }
          })
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
          Effect.fail(
            new Socket.SocketError({
              reason: new Socket.SocketCloseError({
                code: 1000,
                closeReason: 'Closing connection',
              }),
            }),
          ),
        ),
        Effect.tapCause(
          Effect.fn(function* (cause) {
            // CHANGED: set isConnected to false on error
            yield* SubscriptionRef.set(options.isConnected, false)

            const error = Cause.findError(cause)
            if (
              options?.retryTransientErrors !== undefined &&
              Result.isSuccess(error) === true &&
              error.success.reason._tag === 'SocketOpenError'
            ) {
              return
            }
            // yield* Effect.logError('Error in socket', cause)
            currentError = new RpcClientError.RpcClientError({
              reason:
                Result.isSuccess(error) === true
                  ? error.success.reason
                  : new RpcClientError.RpcClientDefect({
                      message: 'Unknown socket error',
                      cause: Cause.squash(cause),
                    }),
            })
            return yield* broadcast({
              _tag: 'ClientProtocolError',
              error: currentError,
            })
          }),
        ),
        // CHANGED: make configurable via schedule
        options?.retryTransientErrors !== undefined ? Effect.retry(options.retryTransientErrors) : Function.identity,
        Effect.annotateLogs({
          module: 'RpcClient',
          method: 'makeProtocolSocket',
        }),
        Effect.interruptible,
        Effect.ignore, // Errors are already handled
        Effect.provideService(References.UnhandledLogLevel, undefined),
        // TODO(#1356): These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
        Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
      )

      return {
        send: (clientId, request) => {
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

export const SocketPinger = Effect.map(RpcClient.Protocol, (protocol) => (protocol as any).pinger as SocketPinger)

export type SocketPinger = Effect.Success<ReturnType<typeof makePinger>>

const makePinger = Effect.fnUntraced(function* <A, E, R>(
  writePing: Effect.Effect<A, E, R>,
  pingSchedule: Schedule.Schedule<unknown> = Schedule.spaced(10000).pipe(Schedule.addDelay(() => Effect.succeed(5000))),
) {
  // CHANGED: add manual ping deferreds
  const manualPingDeferreds = new Set<Deferred.Deferred<void>>()

  let recievedPong = true
  const latch = Latch.makeUnsafe()
  const reset = () => {
    recievedPong = true
    latch.closeUnsafe()
  }
  const onPong = () => {
    recievedPong = true
    // CHANGED: mark all manual ping deferreds as done
    for (const deferred of manualPingDeferreds) {
      Deferred.doneUnsafe(deferred, Effect.void)
    }
  }
  yield* Effect.suspend(() => {
    // Starting new ping
    if (recievedPong === false) return Effect.asVoid(latch.open)
    recievedPong = false
    return Effect.asVoid(writePing)
  }).pipe(
    // CHANGED: make configurable via schedule
    Effect.schedule(pingSchedule),
    Effect.ignore,
    Effect.forever,
    Effect.interruptible,
    // TODO(#1356): These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
    Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
  )

  // CHANGED: add manual ping
  const ping = Effect.gen(function* () {
    const deferred = yield* Deferred.make<void>()
    manualPingDeferreds.add(deferred)
    yield* Deferred.await(deferred)
    manualPingDeferreds.delete(deferred)
  })

  return { timeout: latch.await, reset, onPong, ping } as const
})
