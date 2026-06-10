import { Effect, Fiber, Option, Schema, Stream } from 'effect'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import * as WebChannel from '../../browser/WebChannelBrowser.ts'

describe('WebChannel', () => {
  describe('windowChannel', () => {
    it('should work with 2 windows', () =>
      Effect.gen(function* () {
	        const windowA = new JSDOM('', { url: 'https://livestore.test/a' }).window as unknown as globalThis.Window
	        const windowB = new JSDOM('', { url: 'https://livestore.test/b' }).window as unknown as globalThis.Window

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
	          Stream.mapEffect(Effect.fromResult),
	          Stream.runHead,
	          Effect.map(Option.getOrThrow),
	          Effect.forkChild,
	        )
	        const msgFromAFiber = yield* channelToA.listen.pipe(
	          Stream.mapEffect(Effect.fromResult),
	          Stream.runHead,
	          Effect.map(Option.getOrThrow),
	          Effect.forkChild,
	        )
	        yield* Effect.yieldNow

	        yield* Effect.all([channelToB.send(1), channelToA.send(2)], { concurrency: 'unbounded' })

	        expect(yield* Fiber.join(msgFromBFiber)).toEqual(2)
	        expect(yield* Fiber.join(msgFromAFiber)).toEqual(1)
	      }).pipe(Effect.scoped, Effect.runPromise),
	    )

    it('should work with the same window', () =>
      Effect.gen(function* () {
        const window = new JSDOM().window as unknown as globalThis.Window

        const codeSideA = Effect.gen(function* () {
          const channelToB = yield* WebChannel.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'a', other: 'b' },
            schema: Schema.Number,
          })

	          const msgFromBFiber = yield* channelToB.listen.pipe(
	            Stream.mapEffect(Effect.fromResult),
	            Stream.runHead,
	            Effect.map(Option.getOrThrow),
	            Effect.forkChild,
	          )
	          yield* Effect.yieldNow

	          yield* channelToB.send(1)

          const msgFromB = yield* Fiber.join(msgFromBFiber)
          expect(msgFromB).toEqual(2)
        })

        const codeSideB = Effect.gen(function* () {
          const channelToA = yield* WebChannel.windowChannel({
            listenWindow: window,
            sendWindow: window,
            ids: { own: 'b', other: 'a' },
            schema: Schema.Number,
          })

	          const msgFromAFiber = yield* channelToA.listen.pipe(
	            Stream.mapEffect(Effect.fromResult),
	            Stream.runHead,
	            Effect.map(Option.getOrThrow),
	            Effect.forkChild,
	          )
	          yield* Effect.yieldNow

	          yield* channelToA.send(2)

          const msgFromA = yield* Fiber.join(msgFromAFiber)
          expect(msgFromA).toEqual(1)
        })

        yield* Effect.all([codeSideA, codeSideB], { concurrency: 'unbounded' })
      }).pipe(Effect.scoped, Effect.runPromise),
    )
  })
})
