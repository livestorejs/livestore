import { BucketQueue, Effect, Fiber, FiberHandle } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

// Minimal reproduction of the pusher "thrash" pattern:
// - A background pusher consumes a queue and does some work per batch (simulated by sleep).
// - A "rebase" loop repeatedly clears the pusher fiber, clears the queue, enqueues new items, and restarts the pusher.
// When rebase happens more frequently than the pusher can finish a batch, the pusher makes no progress.

describe('rebase/push thrash (minimal)', () => {
  it('frequent rebase clears starve the pusher (no progress)', async () => {
    let processedBatches = 0

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const leaderPushQueue = yield* BucketQueue.make<number>()
          const pusherHandle = yield* FiberHandle.make<void, never>()

          const pusher = Effect.gen(function* () {
            const batch = yield* BucketQueue.takeBetween(leaderPushQueue, 1, 10)
            // Simulate work per batch
            yield* Effect.sleep('100 millis')
            if (batch.length > 0) processedBatches++
          }).pipe(Effect.forever, Effect.interruptible)

          yield* FiberHandle.run(pusherHandle, pusher)

          // Rebase loop: clear pusher and queue every 20ms and restart
          const rebaser = Effect.gen(function* () {
            for (let i = 0; i < 50; i++) {
              yield* FiberHandle.clear(pusherHandle)
              yield* BucketQueue.clear(leaderPushQueue)
              yield* BucketQueue.offerAll(leaderPushQueue, [1, 2, 3, 4, 5])
              yield* FiberHandle.run(pusherHandle, pusher)
              yield* Effect.sleep('20 millis')
            }
          })

          const fiber = yield* Effect.fork(rebaser)
          // Observe for 600ms; with rebase every 20ms and work taking 100ms, pusher should not complete
          yield* Effect.sleep('600 millis')
          yield* Fiber.interrupt(fiber)
          yield* FiberHandle.clear(pusherHandle)
        }),
      ),
    )

    expect(processedBatches).toBeLessThanOrEqual(1)
  })

  it('slower rebase allows pusher to make progress', async () => {
    let processedBatches = 0

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const leaderPushQueue = yield* BucketQueue.make<number>()
          const pusherHandle = yield* FiberHandle.make<void, never>()

          const pusher = Effect.gen(function* () {
            const batch = yield* BucketQueue.takeBetween(leaderPushQueue, 1, 10)
            yield* Effect.sleep('50 millis')
            if (batch.length > 0) processedBatches++
          }).pipe(Effect.forever, Effect.interruptible)

          yield* FiberHandle.run(pusherHandle, pusher)

          const rebaser = Effect.gen(function* () {
            for (let i = 0; i < 10; i++) {
              yield* FiberHandle.clear(pusherHandle)
              yield* BucketQueue.clear(leaderPushQueue)
              yield* BucketQueue.offerAll(leaderPushQueue, [1, 2, 3, 4, 5])
              yield* FiberHandle.run(pusherHandle, pusher)
              yield* Effect.sleep('200 millis')
            }
          })

          const fiber = yield* Effect.fork(rebaser)
          yield* Effect.sleep('1200 millis')
          yield* Fiber.interrupt(fiber)
          yield* FiberHandle.clear(pusherHandle)
        }),
      ),
    )

    expect(processedBatches).toBeGreaterThanOrEqual(3)
  })
})
