import * as inspector from 'node:inspector'
import type * as Vitest from '@effect/vitest'
import { IS_CI } from '@livestore/utils'
import {
  type Cause,
  Duration,
  Effect,
  type FastCheck as FC,
  identity,
  Layer,
  type OtelTracer,
  Predicate,
  type Schema,
  type Scope,
} from '@livestore/utils/effect'
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
      DEBUGGER_ACTIVE || forceOtel
        ? OtelLiveHttp({ rootSpanName: spanName, serviceName: 'vitest-runner', skipLogUrl: false })
        : OtelLiveDummy

    const combinedLayer = (layer ?? Layer.empty).pipe(Layer.provideMerge(otelLayer))

    return self.pipe(
      DEBUGGER_ACTIVE
        ? identity
        : Effect.logWarnIfTakesLongerThan({
            duration: Duration.toMillis(timeout) * 0.8,
            label: `${spanName} approaching timeout (timeout: ${Duration.format(timeout)})`,
          }),
      DEBUGGER_ACTIVE ? identity : Effect.timeout(timeout),
      Effect.provide(combinedLayer),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.annotateLogs({ suffix }),
    ) as any
  }

/**
 * Equivalent to Vitest.prop but provides extra prop context to the test function
 *
 * TODO: Upstream to Effect
 */
export const asProp = <Arbs extends Vitest.Vitest.Arbitraries, A, E, R>(
  api: Vitest.Vitest.Tester<R>,
  name: string,
  arbitraries: Arbs,
  test: Vitest.Vitest.TestFunction<
    A,
    E,
    R,
    [
      { [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Schema.Schema.Type<Arbs[K]> },
      Vitest.TestContext,
      {
        numRuns: number
        /** 0-based index */
        runIndex: number
      },
    ]
  >,
  propOptions:
    | number
    | (Vitest.TestOptions & {
        fastCheck?: FC.Parameters<{
          [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Schema.Schema.Type<Arbs[K]>
        }>
      }),
) => {
  const numRuns = Predicate.isObject(propOptions) ? (propOptions.fastCheck?.numRuns ?? 100) : 100
  let runIndex = 0
  return api.prop(
    name,
    arbitraries,
    (properties, ctx) => {
      if (ctx.signal.aborted) {
        return ctx.skip('Test aborted')
      }
      return test(properties, ctx, { numRuns, runIndex: runIndex++ })
    },
    propOptions,
  )
}
