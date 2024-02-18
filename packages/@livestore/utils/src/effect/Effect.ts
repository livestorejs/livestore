import type { Context } from 'effect'
import { Cause, Effect, pipe } from 'effect'

import { isNonEmptyString } from '../index.js'

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

/** Logs both on errors and defects */
export const tapCauseLogPretty = <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
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
  <R, E>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tap(eff, (a) => Effect.sync(() => tapFn(a)))

export const debugLogEnv = (msg?: string): Effect.Effect<Context.Context<never>> =>
  pipe(
    Effect.context<never>(),
    Effect.tap((env) => log(msg ?? 'debugLogEnv', env)),
  )
