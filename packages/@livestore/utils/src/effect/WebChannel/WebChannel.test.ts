import * as Vitest from '@effect/vitest'
import { Effect, type Either, Option, Schema, Stream } from 'effect'
import { JSDOM } from 'jsdom'

import * as WebChannelBrowser from '../../browser/WebChannelBrowser.ts'
import * as WebChannel from './WebChannel.ts'

const takeFirstRight = <A, E, R>(stream: Stream.Stream<Either.Either<A, unknown>, E, R>) =>
  stream.pipe(
    Stream.filterMap((msg) => (msg._tag === 'Right' ? Option.some(msg.right) : Option.none())),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new Error('Expected at least one Right message')),
        onSome: (value) => Effect.succeed(value),
      }),
    ),
  )

Vitest.describe('WebChannel', () => {
  Vitest.describe('messagePortChannelWithAck', () => {
    Vitest.scopedLive('should ack even when the receiver is not yet listening', () =>
      Effect.gen(function* () {
        const mc = new MessageChannel()

        const channelAToB = yield* WebChannel.messagePortChannelWithAck({ port: mc.port1, schema: Schema.Number })
        const channelBToA = yield* WebChannel.messagePortChannelWithAck({ port: mc.port2, schema: Schema.Number })

        // Regression test for https://github.com/livestorejs/livestore/issues/262:
        // `send` must not depend on the receiver pulling `listen` immediately, otherwise the first message can hang.
        yield* channelAToB.send(1).pipe(Effect.timeout(100))

        const msgFromA = yield* takeFirstRight<number, never, never>(channelBToA.listen)
        Vitest.expect(msgFromA).toEqual(1)
      }),
    )
  })

  Vitest.describe('windowChannel', () => {
    Vitest.scopedLive('should work with 2 windows', () =>
      Effect.gen(function* () {
        const windowA = new JSDOM().window as unknown as globalThis.Window
        const windowB = new JSDOM().window as unknown as globalThis.Window

        const codeSideA = Effect.gen(function* () {
          const channelToB = yield* WebChannelBrowser.windowChannel({
            listenWindow: windowA,
            sendWindow: windowB,
            ids: { own: 'a', other: 'b' },
            schema: Schema.Number,
          })

          const msgFromBFiber = yield* channelToB.listen.pipe(takeFirstRight<number, never, never>, Effect.fork)

          yield* channelToB.send(1)

          Vitest.expect(yield* msgFromBFiber).toEqual(2)
        })

        const codeSideB = Effect.gen(function* () {
          const channelToA = yield* WebChannelBrowser.windowChannel({
            listenWindow: windowB,
            sendWindow: windowA,
            ids: { own: 'b', other: 'a' },
            schema: Schema.Number,
          })

          const msgFromAFiber = yield* channelToA.listen.pipe(takeFirstRight<number, never, never>, Effect.fork)

          yield* channelToA.send(2)

          Vitest.expect(yield* msgFromAFiber).toEqual(1)
        })

        yield* Effect.all([codeSideA, codeSideB], { concurrency: 'unbounded' })
      }),
    )

    Vitest.scopedLive('should work with the same window', () =>
      Effect.gen(function* () {
        const window = new JSDOM().window as unknown as globalThis.Window

        const codeSideA = Effect.gen(function* () {
          const channelToB = yield* WebChannelBrowser.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'a', other: 'b' },
            schema: Schema.Number,
          })

          const msgFromBFiber = yield* channelToB.listen.pipe(takeFirstRight<number, never, never>, Effect.fork)

          yield* channelToB.send(1)

          Vitest.expect(yield* msgFromBFiber).toEqual(2)
        })

        const codeSideB = Effect.gen(function* () {
          const channelToA = yield* WebChannelBrowser.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'b', other: 'a' },
            schema: Schema.Number,
          })

          const msgFromAFiber = yield* channelToA.listen.pipe(takeFirstRight<number, never, never>, Effect.fork)

          yield* channelToA.send(2)

          Vitest.expect(yield* msgFromAFiber).toEqual(1)
        })

        yield* Effect.all([codeSideA, codeSideB], { concurrency: 'unbounded' })
      }),
    )
  })
})
