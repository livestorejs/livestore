import type { Exit } from 'effect'
import { Deferred, Effect, Runtime } from 'effect'

// See https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
export const withLock =
  (lockName: string, options?: Omit<LockOptions, 'signal'>) =>
  <Ctx, E, A>(eff: Effect.Effect<A, E, Ctx>): Effect.Effect<A | void, E, Ctx> =>
    Effect.gen(function* ($) {
      const runtime = yield* $(Effect.runtime<Ctx>())

      const exit = yield* $(
        Effect.tryPromise<Exit.Exit<A, E>, E>({
          try: (signal) => {
            // NOTE The 'signal' and 'ifAvailable' options cannot be used together.
            const requestOptions = options?.ifAvailable === true ? options : { ...options, signal }
            return navigator.locks.request(lockName, requestOptions, async (lock) => {
              if (lock === null) return

              // TODO also propagate Effect interruption to the execution
              return Runtime.runPromiseExit(runtime)(eff)
            })
          },
          catch: (err) => err as any as E,
        }),
      )

      if (exit._tag === 'Failure') {
        return yield* $(Effect.failCause(exit.cause))
      } else {
        return exit.value
      }
    })

export const waitForDeferredLock = (deferred: Deferred.Deferred<void>, lockName: string) =>
  Effect.async<void>((cb, signal) => {
    navigator.locks.request(lockName, { signal, mode: 'exclusive', ifAvailable: false }, async (_lock) => {
      // immediately continuing calling Effect since we have the lock
      cb(Effect.unit)

      // the code below is still running

      // holding lock until deferred is resolved
      await Effect.runPromise(Deferred.await(deferred))
    })
  })
