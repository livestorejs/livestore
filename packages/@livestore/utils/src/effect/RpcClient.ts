export * from '@effect/rpc/RpcClient'

import { Socket } from '@effect/platform'
import { RpcClient, RpcClientError, RpcSerialization } from '@effect/rpc'
import { Protocol } from '@effect/rpc/RpcClient'
import { constPing, type FromServerEncoded } from '@effect/rpc/RpcMessage'
import { Cause, Deferred, Effect, Layer, Option, Schedule, type Scope } from 'effect'
import { constVoid, identity } from 'effect/Function'
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
  Layer.scoped(Protocol, makeProtocolSocketWithIsConnected(options))

export const makeProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown> | undefined
  // CHANGED: add isConnected subscription ref
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
  // CHANGED: add ping schedule
  readonly pingSchedule?: Schedule.Schedule<unknown> | undefined
}): Effect.Effect<Protocol['Type'], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket> =>
  Protocol.make(
    Effect.fnUntraced(function* (writeResponse) {
      const socket = yield* Socket.Socket
      const serialization = yield* RpcSerialization.RpcSerialization

      const write = yield* socket.writer
      const parser = serialization.unsafeMake()

      const pinger = yield* makePinger(write(parser.encode(constPing)!), options?.pingSchedule)

      yield* Effect.suspend(() => {
        // CHANGED: don't reset parser on every message
        // parser = serialization.unsafeMake()
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
                  if (response._tag === 'Pong') {
                    pinger.onPong()
                  }
                  return writeResponse(response).pipe(
                    // CHANGED: set isConnected to true on pong
                    Effect.tap(
                      Effect.fn(function* () {
                        if (options?.isConnected !== undefined) {
                          yield* SubscriptionRef.set(options.isConnected, true)
                        }
                      }),
                    ),
                  )
                },
                step: constVoid,
              })
            } catch (defect) {
              return writeResponse({
                _tag: 'ClientProtocolError',
                error: new RpcClientError.RpcClientError({
                  reason: 'Protocol',
                  message: 'Error decoding message',
                  cause: Cause.fail(defect),
                }),
              })
            }
          })
          .pipe(
            Effect.raceFirst(
              Effect.zipRight(
                pinger.timeout,
                Effect.fail(
                  new Socket.SocketGenericError({
                    reason: 'OpenTimeout',
                    cause: new Error('ping timeout'),
                  }),
                ),
              ),
            ),
          )
      }).pipe(
        Effect.zipRight(
          Effect.fail(
            new Socket.SocketCloseError({
              reason: 'Close',
              code: 1000,
              closeReason: 'Closing connection',
            }),
          ),
        ),
        Effect.tapErrorCause(
          Effect.fn(function* (cause) {
            // CHANGED: set isConnected to false on error
            if (options?.isConnected !== undefined) {
              yield* SubscriptionRef.set(options.isConnected, false)
            }

            const error = Cause.failureOption(cause)
            if (
              options?.retryTransientErrors &&
              Option.isSome(error) &&
              (error.value.reason === 'Open' || error.value.reason === 'OpenTimeout')
            ) {
              return
            }
            return yield* writeResponse({
              _tag: 'ClientProtocolError',
              error: new RpcClientError.RpcClientError({
                reason: 'Protocol',
                message: 'Error in socket',
                cause: Cause.squash(cause),
              }),
            })
          }),
        ),
        // CHANGED: make configurable via schedule
        options?.retryTransientErrors ? Effect.retry(options.retryTransientErrors) : identity,
        Effect.annotateLogs({
          module: 'RpcClient',
          method: 'makeProtocolSocket',
        }),
        Effect.interruptible,
        Effect.ignore, // Errors are already handled
        Effect.provide(Layer.setUnhandledErrorLogLevel(Option.none())),
        Effect.forkScoped,
      )

      return {
        send: (request) => {
          console.log('send', request)
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

export type SocketPinger = Effect.Effect.Success<ReturnType<typeof makePinger>>

const makePinger = Effect.fnUntraced(function* <A, E, R>(
  writePing: Effect.Effect<A, E, R>,
  pingSchedule: Schedule.Schedule<unknown> = Schedule.spaced(10000).pipe(Schedule.addDelay(() => 5000)),
) {
  // CHANGED: add manual ping deferreds
  const manualPingDeferreds = new Set<Deferred.Deferred<void, never>>()

  let recievedPong = true
  const latch = Effect.unsafeMakeLatch()
  const reset = () => {
    recievedPong = true
    latch.unsafeClose()
  }
  const onPong = () => {
    recievedPong = true
    // CHANGED: mark all manual ping deferreds as done
    for (const deferred of manualPingDeferreds) {
      Deferred.unsafeDone(deferred, Effect.void)
    }
  }
  yield* Effect.suspend(() => {
    // Starting new ping
    if (!recievedPong) return latch.open
    recievedPong = false
    return writePing
  }).pipe(
    // CHANGED: make configurable via schedule
    Effect.schedule(pingSchedule),
    Effect.ignore,
    Effect.forever,
    Effect.interruptible,
    Effect.forkScoped,
  )

  // CHANGED: add manual ping
  const ping = Effect.gen(function* () {
    const deferred = yield* Deferred.make<void, never>()
    manualPingDeferreds.add(deferred)
    yield* deferred
    manualPingDeferreds.delete(deferred)
  })

  return { timeout: latch.await, reset, onPong, ping } as const
})
