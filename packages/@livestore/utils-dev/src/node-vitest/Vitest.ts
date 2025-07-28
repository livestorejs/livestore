import * as inspector from 'node:inspector'
import type * as Vitest from '@effect/vitest'
import { IS_CI } from '@livestore/utils'
import { type Cause, Duration, Effect, identity, Layer, type OtelTracer, type Scope } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'
import { OtelLiveHttp } from '../node/mod.ts'

export * from '@effect/vitest'

export const DEBUGGER_ACTIVE = Boolean(process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined)

export const makeWithTestCtx =
  <R1 = never, E1 = never>(ctxParams: WithTestCtxParams<R1, E1>) =>
  (testContext: Vitest.TestContext) =>
    withTestCtx(testContext, ctxParams)

export type WithTestCtxParams<R1 = never, E1 = never> = {
  suffix?: string
  makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<R1, E1, Scope.Scope>
  timeout?: Duration.DurationInput
  forceOtel?: boolean
}

export const withTestCtx =
  <R1 = never, E1 = never>(
    testContext: Vitest.TestContext,
    {
      suffix,
      makeLayer,
      timeout = IS_CI ? 60_000 : 10_000,
      forceOtel = false,
    }: {
      suffix?: string
      makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<R1, E1, Scope.Scope>
      timeout?: Duration.DurationInput
      forceOtel?: boolean
    } = {},
  ) =>
  <A, E>(
    self: Effect.Effect<A, E, Scope.Scope | OtelTracer.OtelTracer | R1>,
  ): Effect.Effect<A, E | Cause.TimeoutException | E1, Scope.Scope> => {
    const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`
    const layer = makeLayer?.(testContext)

    const otelLayer =
      DEBUGGER_ACTIVE || forceOtel ? OtelLiveHttp({ serviceName: 'vitest-runner', skipLogUrl: false }) : OtelLiveDummy

    return self.pipe(
      DEBUGGER_ACTIVE
        ? identity
        : Effect.logWarnIfTakesLongerThan({
            duration: Duration.toMillis(timeout) * 0.8,
            label: `${spanName} approaching timeout (timeout: ${Duration.format(timeout)})`,
          }),
      DEBUGGER_ACTIVE ? identity : Effect.timeout(timeout),
      Effect.provide(otelLayer),
      Effect.provide(layer ?? Layer.empty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(spanName),
      Effect.annotateLogs({ suffix }),
    ) as any
  }
