import type * as Context from '@effect/data/Context'
import { pipe } from '@effect/data/Function'
import * as Cause from '@effect/io/Cause'
import * as Effect from '@effect/io/Effect'

export * from '@effect/io/Effect'

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

    // @ts-expect-error TODO get proper worker name https://github.com/vitejs/vite/issues/12992
    const threadName = window.__tmpWorkerName ? `Worker ${window.__tmpWorkerName}` : 'Main Thread'

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
