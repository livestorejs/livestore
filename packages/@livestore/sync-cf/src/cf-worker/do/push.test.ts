import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Deferred, Duration, Effect, Fiber, Semaphore } from '@livestore/utils/effect'

import { runSerializedPushAdmission } from './push.ts'

Vitest.describe('sync-cf push admission', () => {
  Vitest.live('publishes an admitted push before honoring interruption', () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1)
      const persisted = yield* Deferred.make<void>()
      const allowBroadcast = yield* Deferred.make<void>()
      const broadcasted = yield* Deferred.make<void>()

      const admissionFiber = yield* runSerializedPushAdmission(
        semaphore,
        Effect.gen(function* () {
          yield* Deferred.succeed(persisted, undefined)
          yield* Deferred.await(allowBroadcast)
          yield* Deferred.succeed(broadcasted, undefined)
        }),
      ).pipe(Effect.forkChild)

      // Reproduce cancellation after persistence but before the pull broadcast handoff.
      yield* Deferred.await(persisted)
      const interruptStarted = yield* Deferred.make<void>()
      const interruptFiber = yield* Effect.gen(function* () {
        yield* Deferred.succeed(interruptStarted, undefined)
        yield* Fiber.interrupt(admissionFiber)
      }).pipe(Effect.forkChild)
      yield* Deferred.await(interruptStarted)
      yield* Effect.yieldNow

      yield* Deferred.succeed(allowBroadcast, undefined)
      yield* Deferred.await(broadcasted).pipe(Effect.timeout(Duration.seconds(1)))
      yield* Fiber.join(interruptFiber)

      Vitest.expect(yield* Deferred.isDone(broadcasted)).toBe(true)
    }),
  )
})
