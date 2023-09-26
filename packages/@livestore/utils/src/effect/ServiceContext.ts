import { pipe } from '@effect/data/Function'
import * as Cause from '@effect/io/Cause'
import * as Effect from '@effect/io/Effect'
import * as Exit from '@effect/io/Exit'
import * as Fiber from '@effect/io/Fiber'
import * as Layer from '@effect/io/Layer'
import type * as Runtime from '@effect/io/Runtime'
import * as Scope from '@effect/io/Scope'

export interface MainLayer<Ctx> {
  layer: Layer.Layer<never, never, Ctx>
  close: Effect.Effect<never, never, void>
}

export const unsafeMainLayer = <Ctx>(original: Layer.Layer<never, never, Ctx>): MainLayer<Ctx> => {
  const scope = Effect.runSync(Scope.make())
  const layer = pipe(
    original,
    Layer.memoize,
    Effect.parallelFinalizers, // NOTE this runs the layer teardown in parallel
    Effect.provideService(Scope.Scope, scope),
    Effect.runSync,
  )
  return { layer, close: Scope.close(scope, Exit.unit) }
}

export const make = <TStaticData, Ctx>(
  staticData: TStaticData,
  runtime: Runtime.Runtime<Ctx>,
  close: Effect.Effect<never, never, void> = Effect.dieMessage('close not implemented'),
): ServiceContext<Ctx, TStaticData> => {
  return {
    provide: (self) => Effect.provide(runtime)(self),
    runWithErrorLog: <E, A>(self: Effect.Effect<Ctx, E, A>) => runWithErrorLog(Effect.provide(runtime)(self)),
    runSync: <E, A>(self: Effect.Effect<Ctx, E, A>) => Effect.runSync(Effect.provide(runtime)(self)),
    runPromiseWithErrorLog: <E, A>(self: Effect.Effect<Ctx, E, A>) =>
      runPromiseWithErrorLog(Effect.provide(runtime)(self)),
    runPromiseExit: <E, A>(self: Effect.Effect<Ctx, E, A>) => Effect.runPromiseExit(Effect.provide(runtime)(self)),
    runPromise: <E, A>(self: Effect.Effect<Ctx, E, A>) => Effect.runPromise(Effect.provide(runtime)(self)),
    withRuntime: (fn) => fn(runtime),
    close: close,
    closePromise: () => Effect.runPromise(close),
    staticData,
  }
}

export interface ServiceContext<Ctx, TStaticData> {
  readonly provide: <E, A>(self: Effect.Effect<Ctx, E, A>) => Effect.Effect<never, E, A>

  /**
   * Fire and Forget. Errors are logged however.
   */
  readonly runWithErrorLog: <E, A>(self: Effect.Effect<Ctx, E, A>) => AbortCallback

  readonly runSync: <E, A>(self: Effect.Effect<Ctx, E, A>) => A

  /**
   * Fire and Forget. A promise that never fails nor returns any value.
   * Errors are logged however.
   */
  readonly runPromiseWithErrorLog: <E, A>(self: Effect.Effect<Ctx, E, A>) => Promise<A | undefined>

  /**
   * A Promise that never fails, the Resolved value is an Exit result that can be either Success or Failed
   */
  readonly runPromiseExit: <E, A>(self: Effect.Effect<Ctx, E, A>) => Promise<Exit.Exit<E, A>>
  readonly runPromise: <E, A>(self: Effect.Effect<Ctx, E, A>) => Promise<A>

  readonly withRuntime: (fn: (runtime: Runtime.Runtime<Ctx>) => void) => void

  /** Closes the ServiceContext and closing all its layers */
  readonly close: Effect.Effect<never, never, void>
  readonly closePromise: () => Promise<void>
  readonly staticData: TStaticData
}

export type AbortCallback = () => void

export const runWithErrorLog = <E, A>(self: Effect.Effect<never, E, A>) => {
  const fiber = Effect.runFork(self)
  fiber.addObserver((ex) => {
    if (ex._tag === 'Failure' && Cause.isInterruptedOnly(ex.cause) === false) {
      console.error(Cause.pretty(ex.cause))
    }
  })
  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

export const runPromiseWithErrorLog = <E, A>(self: Effect.Effect<never, E, A>) =>
  Effect.runPromiseExit(self).then((ex) => {
    if (ex._tag === 'Failure') {
      console.error(Cause.pretty(ex.cause))
      return undefined
    } else {
      return ex.value
    }
  })

export const MissingContext = Effect.die('service context not provided, wrap your app in LiveServiceContext')

export const empty = <Ctx, TStaticData>(): ServiceContext<Ctx, TStaticData> => ({
  provide: () => MissingContext,
  runWithErrorLog: () => runWithErrorLog(MissingContext),
  runSync: () => Effect.runSync(MissingContext),
  runPromiseWithErrorLog: () => runPromiseWithErrorLog(MissingContext),
  runPromiseExit: () => Effect.runPromiseExit(MissingContext),
  runPromise: () => Effect.runPromise(MissingContext),
  withRuntime: () => Effect.runSync(MissingContext),
  close: Effect.dieMessage('Empty ServiceContext cannot be closed'),
  closePromise: () => Promise.reject('Empty ServiceContext cannot be closed'),
  staticData: {} as TStaticData,
})
