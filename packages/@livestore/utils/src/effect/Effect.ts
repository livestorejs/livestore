import * as OtelTracer from '@effect/opentelemetry/Tracer'
import type { Context, Duration, Scope } from 'effect'
import { Cause, Deferred, Effect, Fiber, pipe } from 'effect'
import type { UnknownException } from 'effect/Cause'
import { log } from 'effect/Console'
import type { LazyArg } from 'effect/Function'

import { isNonEmptyString, isPromise } from '../index.js'
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

export const tryAll = <Res>(
  fn: () => Res,
): Res extends Effect.Effect<infer A, infer E, never>
  ? Effect.Effect<A, E | UnknownException, never>
  : Res extends Promise<infer A>
    ? Effect.Effect<A, UnknownException, never>
    : Effect.Effect<Res, UnknownException, never> =>
  Effect.try(() => fn()).pipe(
    Effect.andThen((fnRes) =>
      Effect.isEffect(fnRes)
        ? (fnRes as any as Effect.Effect<any>)
        : isPromise(fnRes)
          ? Effect.promise(() => fnRes)
          : Effect.succeed(fnRes),
    ),
  ) as any

const getThreadName = () => {
  // @ts-expect-error TODO fix types
  const globalName = globalThis.name
  return isNonEmptyString(globalName)
    ? globalName
    : typeof window === 'object'
      ? 'Browser Main Thread'
      : 'unknown-thread'
}

/** Logs both on errors and defects */
export const tapCauseLogPretty = <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.tapErrorCause(eff, (cause) =>
    Effect.gen(function* () {
      if (Cause.isInterruptedOnly(cause)) {
        // console.log('interrupted', Cause.pretty(err), err)
        return
      }

      const span = yield* OtelTracer.currentOtelSpan.pipe(
        Effect.catchTag('NoSuchElementException', (_) => Effect.succeed(undefined)),
      )

      const threadName = getThreadName()
      const firstErrLine = cause.toString().split('\n')[0]
      yield* Effect.logError(`Error on ${threadName}: ${firstErrLine}`, cause).pipe((_) =>
        span === undefined
          ? _
          : Effect.annotateLogs({ spanId: span.spanContext().spanId, traceId: span.spanContext().traceId })(_),
      )
    }),
  )

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
      Effect.timeoutFail({ onTimeout: () => new UnknownError({ cause: options.error }), duration: options.duration })(
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
