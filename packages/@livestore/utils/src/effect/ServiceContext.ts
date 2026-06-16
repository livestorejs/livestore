import type { Context } from 'effect'
import { Cause, Effect, Exit, Fiber, Layer, pipe, Scope } from 'effect'

export interface MainLayer<Ctx> {
  layer: Layer.Layer<Ctx>
  close: Effect.Effect<void>
}

export const unsafeMainLayer = <Ctx>(original: Layer.Layer<Ctx>): MainLayer<Ctx> => {
  const scope = Effect.runSync(Scope.make())
  const layer = pipe(
    original,
    Layer.memoize,
    Effect.parallelFinalizers, // NOTE this runs the layer teardown in parallel
    Effect.provideService(Scope.Scope, scope),
    Effect.runSync,
  )
  return { layer, close: Scope.close(scope, Exit.void) }
}

export const make = <TStaticData, Ctx>(
  staticData: TStaticData,
  services: Context.Context<Ctx>,
  close: Effect.Effect<void> = Effect.die(new Error('close not implemented')),
): ServiceContext<Ctx, TStaticData> => {
  return {
    provide: (self) => self.pipe(Effect.provide(services)),
    runWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) => runWithErrorLog(self.pipe(Effect.provide(services))),
    runSync: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runSync(self.pipe(Effect.provide(services))),
    runPromiseWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) =>
      runPromiseWithErrorLog(self.pipe(Effect.provide(services))),
    runPromiseExit: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runPromiseExit(self.pipe(Effect.provide(services))),
    runPromise: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runPromise(self.pipe(Effect.provide(services))),
    withServices: (fn) => fn(services),
    close: close,
    closePromise: () => Effect.runPromise(close),
    staticData,
  }
}

export interface ServiceContext<Ctx, TStaticData> {
  readonly provide: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.Effect<A, E>

  /**
   * Fire and Forget. Errors are logged however.
   */
  readonly runWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) => AbortCallback

  readonly runSync: <E, A>(self: Effect.Effect<A, E, Ctx>) => A

  /**
   * Fire and Forget. A promise that never fails nor returns any value.
   * Errors are logged however.
   */
  readonly runPromiseWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) => Promise<A | undefined>

  /**
   * A Promise that never fails, the Resolved value is an Exit result that can be either Success or Failed
   */
  readonly runPromiseExit: <E, A>(self: Effect.Effect<A, E, Ctx>) => Promise<Exit.Exit<A, E>>
  readonly runPromise: <E, A>(self: Effect.Effect<A, E, Ctx>) => Promise<A>

  readonly withServices: (fn: (services: Context.Context<Ctx>) => void) => void

  /** Closes the ServiceContext and closing all its layers */
  readonly close: Effect.Effect<void>
  readonly closePromise: () => Promise<void>
  readonly staticData: TStaticData
}

export type AbortCallback = () => void

export const runWithErrorLog = <E, A>(self: Effect.Effect<A, E>) => {
  const fiber = Effect.runFork(self)
  fiber.addObserver((ex) => {
    if (ex._tag === 'Failure' && Cause.hasInterruptsOnly(ex.cause) === false) {
      console.error(Cause.pretty(ex.cause))
    }
  })
  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

export const runPromiseWithErrorLog = <E, A>(self: Effect.Effect<A, E>) =>
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
  withServices: () => Effect.runSync(MissingContext),
  close: Effect.die(new Error('Empty ServiceContext cannot be closed')),
  closePromise: () => Promise.reject('Empty ServiceContext cannot be closed'),
  staticData: {} as TStaticData,
})
