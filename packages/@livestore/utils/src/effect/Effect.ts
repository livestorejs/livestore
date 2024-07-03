import type { Context, Duration } from 'effect'
import { Cause, Deferred, Effect, pipe } from 'effect'
import type { LazyArg } from 'effect/Function'

import { isNonEmptyString } from '../index.js'
import { UnknownError } from './Error.js'

export * from 'effect/Effect'

export const log = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(message, ...rest)
  })

export const logWarn = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
  Effect.sync(() => {
    console.warn(message, ...rest)
  })

export const logError = <A>(message: A, ...rest: any[]): Effect.Effect<void> =>
  Effect.sync(() => {
    console.error(message, ...rest)
  })

const getThreadName = () =>
  isNonEmptyString(self.name) ? self.name : typeof window === 'object' ? 'Browser Main Thread' : 'unknown-thread'

/** Logs both on errors and defects */
export const tapCauseLogPretty = <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.tapErrorCause(eff, (err) => {
    if (Cause.isInterruptedOnly(err)) {
      return Effect.void
    }

    const threadName = getThreadName()

    // const prettyError = (err as any).error ? (err as any).error.toString() : Cause.pretty(err)
    const prettyError = Cause.pretty(err)

    return logError(`Error on ${threadName}:`, prettyError)
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
): Effect.Effect<Deferred.Deferred<A, E>, never, R> =>
  pipe(
    Deferred.make<A, E>(),
    Effect.tap((deferred) =>
      pipe(
        Effect.exit(eff),
        Effect.flatMap((ex) => Deferred.done(deferred, ex)),
        Effect.forkDaemon,
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
