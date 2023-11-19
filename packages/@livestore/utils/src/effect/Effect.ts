import type { Context } from 'effect'
import { Cause, Effect, pipe } from 'effect'

import { isNonEmptyString } from '../index.js'

export * from 'effect/Effect'

export const log = <A>(message: A, ...rest: any[]): Effect.Effect<never, never, void> =>
  Effect.sync(() => {
    console.log(message, ...rest)
  })

export const logWarn = <A>(message: A, ...rest: any[]): Effect.Effect<never, never, void> =>
  Effect.sync(() => {
    console.warn(message, ...rest)
  })

export const logError = <A>(message: A, ...rest: any[]): Effect.Effect<never, never, void> =>
  Effect.sync(() => {
    console.error(message, ...rest)
  })

/** Logs both on errors and defects */
export const tapCauseLogPretty = <R, E, A>(eff: Effect.Effect<R, E, A>): Effect.Effect<R, E, A> =>
  Effect.tapErrorCause(eff, (err) => {
    if (Cause.isInterruptedOnly(err)) {
      return Effect.unit
    }

    const threadName =
      typeof window === 'undefined' ? 'NodeJS Main Thread' : isNonEmptyString(self.name) ? self.name : 'unknown-thread'

    return logError(`Error on ${threadName}`, Cause.pretty(err))
  })

export const tapSync =
  <A>(tapFn: (a: A) => unknown) =>
  <R, E>(eff: Effect.Effect<R, E, A>): Effect.Effect<R, E, A> =>
    Effect.tap(eff, (a) => Effect.sync(() => tapFn(a)))

export const debugLogEnv = (msg?: string): Effect.Effect<never, never, Context.Context<never>> =>
  pipe(
    Effect.context<never>(),
    Effect.tap((env) => log(msg ?? 'debugLogEnv', env)),
  )
