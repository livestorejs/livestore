import * as OtelTracer from '@effect/opentelemetry/Tracer'
import type { Context, Duration, Stream } from 'effect'
import { Cause, Deferred, Effect, Fiber, FiberRef, HashSet, Logger, pipe, Scope } from 'effect'
import type { UnknownException } from 'effect/Cause'
import { log } from 'effect/Console'
import type { LazyArg } from 'effect/Function'

import { isPromise } from '../index.ts'
import { UnknownError } from './Error.ts'

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

/** Same as `Effect.scopeWith` but with a `CloseableScope` instead of a `Scope`. */
export const scopeWithCloseable = <R, E, A>(
  fn: (scope: Scope.CloseableScope) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    // const parentScope = yield* Scope.Scope
    // const scope = yield* Scope.fork(parentScope, ExecutionStrategy.sequential)
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
    return yield* fn(scope).pipe(Scope.extend(scope))
  })

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

export const acquireReleaseLog = (label: string) =>
  Effect.acquireRelease(Effect.log(`${label} acquire`), (_, ex) => Effect.log(`${label} release`, ex))

export const addFinalizerLog = (...msgs: any[]) =>
  Effect.addFinalizer((exit) =>
    Effect.log(...msgs, exit._tag === 'Success' ? 'with success' : `with failure: ${Cause.pretty(exit.cause)}`),
  )

export const logBefore =
  (...msgs: any[]) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.andThen(Effect.log(...msgs), eff)

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

      const firstErrLine = cause.toString().split('\n')[0]
      yield* Effect.logError(firstErrLine, cause).pipe((_) =>
        span === undefined
          ? _
          : Effect.annotateLogs({ spanId: span.spanContext().spanId, traceId: span.spanContext().traceId })(_),
      )
    }),
  )

export const eventListener = <TEvent = unknown>(
  target: Stream.EventListener<TEvent>,
  type: string,
  handler: (event: TEvent) => Effect.Effect<void, never, never>,
  options?: { once?: boolean },
) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>()

    const handlerFn = (event: TEvent) => handler(event).pipe(Effect.provide(runtime), Effect.runFork)

    target.addEventListener(type, handlerFn, { once: options?.once ?? false })

    yield* Effect.addFinalizer(() => Effect.sync(() => target.removeEventListener(type, handlerFn)))
  })

export const spanEvent = (message: any, attributes?: Record<string, any>) =>
  Effect.locallyWith(Effect.log(message).pipe(Effect.annotateLogs(attributes ?? {})), FiberRef.currentLoggers, () =>
    HashSet.make(Logger.tracerLogger),
  )

export const logWarnIfTakesLongerThan =
  ({ label, duration }: { label: string; duration: Duration.DurationInput }) =>
  <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>()

      let tookLongerThanTimer = false

      const timeoutFiber = Effect.sleep(duration).pipe(
        Effect.tap(() => {
          tookLongerThanTimer = true
          // TODO include span info
          return Effect.logWarning(`${label}: Took longer than ${duration}ms`)
        }),
        Effect.provide(runtime),
        Effect.runFork,
      )

      const start = Date.now()
      const res = yield* eff.pipe(
        Effect.exit,
        Effect.onInterrupt(
          Effect.fn(function* () {
            const end = Date.now()

            yield* Fiber.interrupt(timeoutFiber)

            if (tookLongerThanTimer) {
              yield* Effect.logWarning(`${label}: Interrupted after ${end - start}ms`)
            }
          }),
        ),
      )

      if (tookLongerThanTimer) {
        const end = Date.now()
        yield* Effect.logWarning(`${label}: Actual duration: ${end - start}ms`)
      }

      yield* Fiber.interrupt(timeoutFiber)

      return yield* res
    })

export const logDuration =
  (label: string) =>
  <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const start = Date.now()
      const res = yield* eff
      const end = Date.now()
      yield* Effect.log(`${label}: ${end - start}ms`)
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

const getSpanTrace = () => {
  const fiberOption = Fiber.getCurrentFiber()
  if (fiberOption._tag === 'None' || fiberOption.value.currentSpan === undefined) {
    return 'No current fiber'
  }

  return ''
  // const msg = Effect.runSync(
  //   Effect.fail({ message: '' }).pipe(
  //     Effect.withParentSpan(fiberOption.value.currentSpan),
  //     Effect.catchAllCause((cause) => Effect.succeed(cause.toString())),
  //   ),
  // )

  // // remove the first line
  // return msg
  //   .split('\n')
  //   .slice(1)
  //   .map((_) => _.trim().replace('at ', ''))
  //   .join('\n')
}

const logSpanTrace = () => console.log(getSpanTrace())

// @ts-expect-error TODO fix types
globalThis.getSpanTrace = getSpanTrace
// @ts-expect-error TODO fix types
globalThis.logSpanTrace = logSpanTrace
