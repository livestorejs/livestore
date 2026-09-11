import * as inspector from 'node:inspector'

import type * as Vitest from '@effect/vitest'

import { IS_CI } from '@livestore/utils'
import { type Cause, Duration, Effect, identity, Layer, type OtelTracer, type Scope } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'

import { OtelLiveHttp } from '../node/mod.ts'

export * from '@effect/vitest'

export const DEBUGGER_ACTIVE = Boolean(process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined)

type WithoutTestCtxServices<R> = Exclude<Exclude<R, OtelTracer.OtelTracer>, Scope.Scope>
type WithoutLayerAndTestCtxServices<R, ROut> = Exclude<Exclude<R, ROut | OtelTracer.OtelTracer>, Scope.Scope>

export const makeWithTestCtx: <ROut = never, E1 = never, RIn = never>(
  ctxParams: WithTestCtxParams<ROut, E1, RIn>,
) => (testContext: Vitest.TestContext) => <A, E, R>(
  self: Effect.Effect<A, E, R>,
) => Effect.Effect<
  A,
  E | E1 | Cause.TimeoutError,
  // Exclude dependencies provided by `withTestCtx` from the layer dependencies
  | WithoutTestCtxServices<RIn>
  // Exclude dependencies provided by `withTestCtx` **and** dependencies produced
  // by the layer from the effect dependencies
  | WithoutLayerAndTestCtxServices<R, ROut>
> = (ctxParams) => (testContext: Vitest.TestContext) => withTestCtx(testContext, ctxParams)

export type WithTestCtxParams<ROut, E1, RIn> = {
  suffix?: string
  makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<ROut, E1, RIn | Scope.Scope>
  timeout?: Duration.Input
  forceOtel?: boolean
}

export const withTestCtx =
  <ROut = never, E1 = never, RIn = never>(
    testContext: Vitest.TestContext,
    {
      suffix,
      makeLayer,
      timeout = IS_CI === true ? 60_000 : 10_000,
      forceOtel = false,
    }: {
      suffix?: string
      makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<ROut, E1, RIn | Scope.Scope>
      timeout?: Duration.Input
      forceOtel?: boolean
    } = {},
  ) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E | E1 | Cause.TimeoutError,
    // Exclude dependencies provided internally from the provided layer's dependencies
    | WithoutTestCtxServices<RIn>
    // Exclude dependencies provided internally **and** dependencies produced by the
    // provided layer from the effect dependencies
    | WithoutLayerAndTestCtxServices<R, ROut>
  > => {
    const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix !== undefined ? `:${suffix}` : ''}`
    // `Layer.empty` provides `never`, which is narrower than an arbitrary generic
    // `ROut`; widen it for the no-layer branch so `Effect.provide` can typecheck.
    const layer: Layer.Layer<ROut, E1, RIn | Scope.Scope> =
      makeLayer?.(testContext) ?? (Layer.empty as unknown as Layer.Layer<ROut, E1, RIn | Scope.Scope>)
    const timeoutDuration = Duration.fromInputUnsafe(timeout)

    const otelLayer =
      DEBUGGER_ACTIVE === true || forceOtel === true
        ? OtelLiveHttp({ rootSpanName: spanName, serviceName: 'vitest-runner', skipLogUrl: false })
        : OtelLiveDummy

    const combinedLayer = layer.pipe(Layer.provideMerge(otelLayer))

    return self.pipe(
      DEBUGGER_ACTIVE === true
        ? identity
        : Effect.logWarnIfTakesLongerThan({
            duration: Duration.toMillis(timeoutDuration) * 0.8,
            label: `${spanName} approaching timeout (timeout: ${Duration.format(timeoutDuration)})`,
          }),
      DEBUGGER_ACTIVE === true ? identity : Effect.timeout(timeout),
      Effect.provide(combinedLayer),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.annotateLogs({ suffix }),
    )
  }
