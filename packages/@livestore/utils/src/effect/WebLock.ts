import type { Exit } from 'effect'
import { Deferred, Effect, Runtime } from 'effect'

// See https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
export const withLock =
  <E2>({
    lockName,
    onTaken,
    options,
  }: {
    lockName: string
    onTaken?: Effect.Effect<void, E2>
    options?: Omit<LockOptions, 'signal'>
  }) =>
  <Ctx, E, A>(eff: Effect.Effect<A, E, Ctx>): Effect.Effect<A | void, E | E2, Ctx> =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<Ctx>()

      const exit = yield* Effect.tryPromise<Exit.Exit<A, E>, E | E2>({
        try: (signal) => {
          if (signal.aborted) return 'aborted' as never

          // NOTE The 'signal' and 'ifAvailable' options cannot be used together.
          const requestOptions = options?.ifAvailable === true ? options : { ...options, signal }
          return navigator.locks.request(lockName, requestOptions, async (lock) => {
            if (lock === null) {
              if (onTaken) {
                const exit = await Runtime.runPromiseExit(runtime)(onTaken)
                if (exit._tag === 'Failure') {
                  return exit
                }
              }
              return
            }

            // TODO also propagate Effect interruption to the execution
            return Runtime.runPromiseExit(runtime)(eff)
          })
        },
        catch: (err) => err as any as E,
      })

      if (exit._tag === 'Failure') {
        return yield* Effect.failCause(exit.cause)
      } else {
        return exit.value
      }
    })

export const waitForDeferredLock = (deferred: Deferred.Deferred<void>, lockName: string) =>
  Effect.async<void>((cb, signal) => {
    if (signal.aborted) return

    navigator.locks
      .request(lockName, { signal, mode: 'exclusive', ifAvailable: false }, (_lock) => {
        // immediately continuing calling Effect since we have the lock
        cb(Effect.void)

        // the code below is still running

        // holding lock until deferred is resolved
        return Effect.runPromise(Deferred.await(deferred))
      })
      .catch((error) => {
        if (error.code === 20 && error.message === 'signal is aborted without reason') {
          // Given signal interruption is handled via Effect, we can ignore this case
        } else {
          throw error
        }
      })
  })

export const tryGetDeferredLock = (deferred: Deferred.Deferred<void>, lockName: string) =>
  Effect.async<boolean>((cb, signal) => {
    navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      cb(Effect.succeed(lock !== null))

      // the code below is still running

      const abortPromise = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve()
        })
      })

      // holding lock until deferred is resolved
      return Promise.race([
        Effect.runPromise(Deferred.await(deferred)),
        // .finally(() =>
        //   console.log('[@livestore/utils:WebLock] tryGetDeferredLock. finally', lockName),
        // ),
        abortPromise,
      ])
    })
  })
