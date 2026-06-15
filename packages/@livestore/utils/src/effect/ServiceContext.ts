import type { Context } from 'effect'
import { Cause, Effect, Exit, Fiber, Layer, Scope } from 'effect'

export interface MainLayer<Ctx> {
  layer: Layer.Layer<Ctx>
  close: Effect.Effect<void>
}

export const unsafeMainLayer = <Ctx>(original: Layer.Layer<Ctx>): MainLayer<Ctx> => {
  const scope = Effect.runSync(Scope.make())
  const context = Effect.runSync(original.pipe(Layer.buildWithScope(scope)))
  const layer = Layer.succeedContext(context)
  return { layer, close: Scope.close(scope, Exit.void) }
}

export const make = <TStaticData, Ctx>(
  staticData: TStaticData,
  context: Context.Context<Ctx>,
  close: Effect.Effect<void> = Effect.die(new Error('close not implemented')),
): ServiceContext<Ctx, TStaticData> => {
  return {
    provide: (self) => self.pipe(Effect.provideContext(context)),
    runWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) => runWithErrorLog(Effect.provideContext(self, context)),
    runSync: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runSyncWith(context)(self),
    runPromiseWithErrorLog: <E, A>(self: Effect.Effect<A, E, Ctx>) =>
      runPromiseWithErrorLog(Effect.provideContext(self, context)),
    runPromiseExit: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runPromiseExitWith(context)(self),
    runPromise: <E, A>(self: Effect.Effect<A, E, Ctx>) => Effect.runPromiseWith(context)(self),
    withRuntime: (fn) => fn(context),
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

  readonly withRuntime: (fn: (context: Context.Context<Ctx>) => void) => void

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
  withRuntime: () => Effect.runSync(MissingContext),
  close: Effect.die(new Error('Empty ServiceContext cannot be closed')),
  closePromise: () => Promise.reject('Empty ServiceContext cannot be closed'),
  staticData: {} as TStaticData,
})
