import * as Vitest from '@effect/vitest'
import { Effect, Fiber, Schema, Stream } from 'effect'
import { JSDOM } from 'jsdom'

import * as WebChannel from '../../browser/WebChannelBrowser.ts'

Vitest.describe('WebChannel', () => {
  Vitest.describe('windowChannel', () => {
    Vitest.live('should work with 2 windows', () =>
      Effect.gen(function* () {
        const windowA = new JSDOM().window as unknown as globalThis.Window
        const windowB = new JSDOM().window as unknown as globalThis.Window

        const channelToB = yield* WebChannel.windowChannel({
          listenWindow: windowA,
          sendWindow: windowB,
          ids: { own: 'a', other: 'b' },
          schema: Schema.Number,
        })

        const channelToA = yield* WebChannel.windowChannel({
          listenWindow: windowB,
          sendWindow: windowA,
          ids: { own: 'b', other: 'a' },
          schema: Schema.Number,
        })

        const msgFromBFiber = yield* channelToB.listen.pipe(
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap(Effect.fromResult),
          // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
          Effect.forkChild({ startImmediately: true, uninterruptible: 'inherit' }),
        )
        const msgFromAFiber = yield* channelToA.listen.pipe(
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap(Effect.fromResult),
          // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
          Effect.forkChild({ startImmediately: true, uninterruptible: 'inherit' }),
        )

        yield* channelToB.send(1)
        yield* channelToA.send(2)

        Vitest.expect(yield* Fiber.join(msgFromBFiber)).toEqual(2)
        Vitest.expect(yield* Fiber.join(msgFromAFiber)).toEqual(1)
      }),
    )

    Vitest.live('should work with the same window', () =>
      Effect.gen(function* () {
        const window = new JSDOM().window as unknown as globalThis.Window

        const channelToB = yield* WebChannel.windowChannel({
          listenWindow: window,
          sendWindow: window,
          ids: { own: 'a', other: 'b' },
          schema: Schema.Number,
        })

        const channelToA = yield* WebChannel.windowChannel({
          listenWindow: window,
          sendWindow: window,
          ids: { own: 'b', other: 'a' },
          schema: Schema.Number,
        })

        const msgFromBFiber = yield* channelToB.listen.pipe(
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap(Effect.fromResult),
          // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
          Effect.forkChild({ startImmediately: true, uninterruptible: 'inherit' }),
        )
        const msgFromAFiber = yield* channelToA.listen.pipe(
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap(Effect.fromResult),
          // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
          Effect.forkChild({ startImmediately: true, uninterruptible: 'inherit' }),
        )

        yield* channelToB.send(1)
        yield* channelToA.send(2)

        Vitest.expect(yield* Fiber.join(msgFromBFiber)).toEqual(2)
        Vitest.expect(yield* Fiber.join(msgFromAFiber)).toEqual(1)
      }),
    )
  })
})
