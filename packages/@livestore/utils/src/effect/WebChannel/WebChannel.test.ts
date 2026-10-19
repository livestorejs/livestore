import * as Vitest from '@effect/vitest'
import { Effect, Exit, Fiber, Schema, Scope, Stream } from 'effect'
import { JSDOM } from 'jsdom'

import * as WebChannel from '../../browser/WebChannelBrowser.ts'
import { sameThreadChannel } from './WebChannel.ts'

Vitest.describe('WebChannel', () => {
  Vitest.describe('windowChannel', () => {
    Vitest.live('should work with 2 windows', () =>
      Effect.gen(function* () {
        const windowA = new JSDOM().window as unknown as globalThis.Window
        const windowB = new JSDOM().window as unknown as globalThis.Window

        const codeSideA = Effect.gen(function* () {
          const channelToB = yield* WebChannel.windowChannel({
            listenWindow: windowA,
            sendWindow: windowB,
            ids: { own: 'a', other: 'b' },
            schema: Schema.Finite,
          })

          const msgFromBFiber = yield* channelToB.listen.pipe(
            Stream.runHead,
            Effect.flatMap(Effect.fromOption),
            Effect.flatMap(Effect.fromResult),
            Effect.forkChild,
          )

          yield* channelToB.send(1)

          Vitest.expect(yield* Fiber.join(msgFromBFiber)).toEqual(2)
        })

        const codeSideB = Effect.gen(function* () {
          const channelToA = yield* WebChannel.windowChannel({
            listenWindow: windowB,
            sendWindow: windowA,
            ids: { own: 'b', other: 'a' },
            schema: Schema.Finite,
          })

          const msgFromAFiber = yield* channelToA.listen.pipe(
            Stream.runHead,
            Effect.flatMap(Effect.fromOption),
            Effect.flatMap(Effect.fromResult),
            Effect.forkChild,
          )

          yield* channelToA.send(2)

          Vitest.expect(yield* Fiber.join(msgFromAFiber)).toEqual(1)
        })

        yield* Effect.all([codeSideA, codeSideB], { concurrency: 'unbounded' })
      }),
    )

    Vitest.live('should work with the same window', () =>
      Effect.gen(function* () {
        const window = new JSDOM().window as unknown as globalThis.Window

        const codeSideA = Effect.gen(function* () {
          const channelToB = yield* WebChannel.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'a', other: 'b' },
            schema: Schema.Finite,
          })

          const msgFromBFiber = yield* channelToB.listen.pipe(
            Stream.runHead,
            Effect.flatMap(Effect.fromOption),
            Effect.flatMap(Effect.fromResult),
            Effect.forkChild,
          )

          yield* channelToB.send(1)

          Vitest.expect(yield* Fiber.join(msgFromBFiber)).toEqual(2)
        })

        const codeSideB = Effect.gen(function* () {
          const channelToA = yield* WebChannel.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'b', other: 'a' },
            schema: Schema.Finite,
          })

          const msgFromAFiber = yield* channelToA.listen.pipe(
            Stream.runHead,
            Effect.flatMap(Effect.fromOption),
            Effect.flatMap(Effect.fromResult),
            Effect.forkChild,
          )

          yield* channelToA.send(2)

          Vitest.expect(yield* Fiber.join(msgFromAFiber)).toEqual(1)
        })

        yield* Effect.all([codeSideA, codeSideB], { concurrency: 'unbounded' })
      }),
    )
  })

  Vitest.describe('sameThreadChannel', () => {
    Vitest.live('keeps working for a later user after the first one closes', () =>
      Effect.gen(function* () {
        const channelName = 'same-thread-shared-close'
        const scopeA = yield* Scope.make()
        const scopeB = yield* Scope.make()

        yield* sameThreadChannel({ schema: Schema.Finite, channelName }).pipe(Scope.provide(scopeA))
        const channelB = yield* sameThreadChannel({ schema: Schema.Finite, channelName }).pipe(Scope.provide(scopeB))

        yield* Scope.close(scopeA, Exit.void)

        const msgFiber = yield* channelB.listen.pipe(
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap(Effect.fromResult),
          Effect.forkChild,
        )
        yield* Effect.yieldNow
        yield* channelB.send(1)

        Vitest.expect(yield* Fiber.join(msgFiber)).toEqual(1)

        yield* Scope.close(scopeB, Exit.void)
      }),
    )
  })
})
