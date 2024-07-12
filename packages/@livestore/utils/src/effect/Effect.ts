import type { Context, Duration, Scope } from 'effect'
import { Cause, Deferred, Effect, Fiber, pipe } from 'effect'
import { log } from 'effect/Console'
import type { LazyArg } from 'effect/Function'

import { isNonEmptyString } from '../index.js'
import { UnknownError } from './Error.js'

export * from 'effect/Effect'

// export const log = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
//   Effect.sync(() => {
//     console.log(message, ...rest)
//   })

// export const logWarn = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
//   Effect.sync(() => {
//     console.warn(message, ...rest)
//   })

// export const logError = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
//   Effect.sync(() => {
//     console.error(message, ...rest)
//   })

const getThreadName = () =>
  isNonEmptyString(self.name) ? self.name : typeof window === 'object' ? 'Browser Main Thread' : 'unknown-thread'

/** Logs both on errors and defects */
export const tapCauseLogPretty = <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.tapErrorCause(eff, (err) => {
    if (Cause.isInterruptedOnly(err)) {
      console.log('interrupted', Cause.pretty(err), err)
      return Effect.void
    }

    const threadName = getThreadName()

    // const prettyError = (err as any).error ? (err as any).error.toString() : Cause.pretty(err)
    // const prettyError = Cause.pretty(err)

    // return Effect.logError(`Error on ${threadName}:`, prettyError)
    const firstErrLine = err.toString().split('\n')[0]
    return Effect.logError(`Error on ${threadName}: ${firstErrLine}`, err)
  })

export const logWarnIfTakesLongerThan =
  ({ label, duration }: { label: string; duration: Duration.DurationInput }) =>
  <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>()

      let timedOut = false

      const timeoutFiber = Effect.sleep(duration).pipe(
        Effect.tap(() => {
          timedOut = true
          // TODO include span info
          return Effect.logWarning(`${label}: Took longer than ${duration}ms`)
        }),
        Effect.provide(runtime),
        Effect.runFork,
      )

      const start = Date.now()
      const res = yield* eff

      if (timedOut) {
        const end = Date.now()
        yield* Effect.logWarning(`${label}: Actual duration: ${end - start}ms`)
      }

      yield* Fiber.interrupt(timeoutFiber)

      return res
    })

export const tapSync =
  <A>(tapFn: (a: A) => unknown) =>
  <R, E>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tap(eff, (a) => Effect.sync(() => tapFn(a)))

export const debugLogEnv = (msg?: string): Effect.Effect<Context.Context<never>> =>
  pipe(
    Effect.context<never>(),
    Effect.tap((env) => log(msg ?? 'debugLogEnv', env)),
  )

export const timeoutDie =
  <E1>(options: { onTimeout: LazyArg<E1>; duration: Duration.DurationInput }) =>
  <R, E, A>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.orDie(Effect.timeoutFail(options)(self))

export const timeoutDieMsg =
  (options: { error: string; duration: Duration.DurationInput }) =>
  <R, E, A>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.orDie(
      Effect.timeoutFail({ onTimeout: () => new UnknownError({ error: options.error }), duration: options.duration })(
        self,
      ),
    )

export const toForkedDeferred = <R, E, A>(
  eff: Effect.Effect<A, E, R>,
): Effect.Effect<Deferred.Deferred<A, E>, never, R | Scope.Scope> =>
  pipe(
    Deferred.make<A, E>(),
    Effect.tap((deferred) =>
      pipe(
        Effect.exit(eff),
        Effect.flatMap((ex) => Deferred.done(deferred, ex)),
        tapCauseLogPretty,
        Effect.forkScoped,
      ),
    ),
  )

export const withPerformanceMeasure =
  (meaureLabel: string) =>
  <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => performance.mark(`${meaureLabel}:start`)),
      () => eff,
      () =>
        Effect.sync(() => {
          performance.mark(`${meaureLabel}:end`)
          performance.measure(meaureLabel, `${meaureLabel}:start`, `${meaureLabel}:end`)
        }),
    )
