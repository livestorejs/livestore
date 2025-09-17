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

export const makeWithTestCtx: <ROut, E1, RIn>(
  ctxParams: WithTestCtxParams<ROut, E1, RIn>,
) => (testContext: Vitest.TestContext) => <A, E, R>(
  self: Effect.Effect<A, E, R>,
) => Effect.Effect<
  A,
  E | E1 | Cause.TimeoutException,
  // Exclude dependencies provided by `withTestCtx` from the layer dependencies
  | Exclude<RIn, OtelTracer.OtelTracer | Scope.Scope>
  // Exclude dependencies provided by `withTestCtx` **and** dependencies produced
  // by the layer from the effect dependencies
  | Exclude<R, ROut | OtelTracer.OtelTracer | Scope.Scope>
> = (ctxParams) => (testContext: Vitest.TestContext) => withTestCtx(testContext, ctxParams)

export type WithTestCtxParams<ROut, E1, RIn> = {
  suffix?: string
  makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<ROut, E1, RIn | Scope.Scope>
  timeout?: Duration.DurationInput
  forceOtel?: boolean
}

export const withTestCtx =
  <ROut = never, E1 = never, RIn = never>(
    testContext: Vitest.TestContext,
    {
      suffix,
      makeLayer,
      timeout = IS_CI ? 60_000 : 10_000,
      forceOtel = false,
    }: {
      suffix?: string
      makeLayer?: (testContext: Vitest.TestContext) => Layer.Layer<ROut, E1, RIn>
      timeout?: Duration.DurationInput
      forceOtel?: boolean
    } = {},
  ) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E | E1 | Cause.TimeoutException,
    // Exclude dependencies provided internally from the provided layer's dependencies
    | Exclude<RIn, OtelTracer.OtelTracer | Scope.Scope>
    // Exclude dependencies provided internally **and** dependencies produced by the
    // provided layer from the effect dependencies
    | Exclude<R, ROut | OtelTracer.OtelTracer | Scope.Scope>
  > => {
    const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`
    const layer = makeLayer?.(testContext) ?? Layer.empty

    const otelLayer =
      DEBUGGER_ACTIVE || forceOtel
        ? OtelLiveHttp({ rootSpanName: spanName, serviceName: 'vitest-runner', skipLogUrl: false })
        : OtelLiveDummy

    const combinedLayer = layer.pipe(Layer.provideMerge(otelLayer))

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
 * Shared properties for all enhanced test context phases
 */
export interface EnhancedTestContextBase {
  numRuns: number
  /** 0-based index */
  runIndex: number
  /** Total number of executions including initial runs and shrinking attempts */
  totalExecutions: number
}

/**
 * Enhanced context for property-based tests that includes shrinking phase information
 */
export type EnhancedTestContext =
  | (EnhancedTestContextBase & {
      _tag: 'initial'
    })
  | (EnhancedTestContextBase & {
      _tag: 'shrinking'
      /** Number of shrinking attempts */
      shrinkAttempt: number
    })

/**
 * Normalizes propOptions to ensure @effect/vitest receives correct fastCheck structure
 */
const normalizePropOptions = <Arbs extends Vitest.Vitest.Arbitraries>(
  propOptions:
    | number
    | (Vitest.TestOptions & {
        fastCheck?: FC.Parameters<{
          [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Schema.Schema.Type<Arbs[K]>
        }>
      }),
): Vitest.TestOptions & {
  fastCheck?: FC.Parameters<{
    [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Schema.Schema.Type<Arbs[K]>
  }>
} => {
  // If it's a number, treat as timeout and add our default fastCheck
  if (!Predicate.isObject(propOptions)) {
    return {
      timeout: propOptions,
      fastCheck: { numRuns: 100 },
    }
  }

  // If no fastCheck property, add it with our default numRuns
  if (!propOptions.fastCheck) {
    return {
      ...propOptions,
      fastCheck: { numRuns: 100 },
    }
  }

  // If fastCheck exists but no numRuns, add our default
  if (propOptions.fastCheck && !propOptions.fastCheck.numRuns) {
    return {
      ...propOptions,
      fastCheck: {
        ...propOptions.fastCheck,
        numRuns: 100,
      },
    }
  }

  // If everything is properly structured, pass through
  return propOptions
}

/**
 * Equivalent to Vitest.prop but provides enhanced context including shrinking progress visibility
 *
 * This function enhances the standard property-based testing by providing clear information about
 * whether FastCheck is in the initial testing phase or the shrinking phase, solving the confusion
 * where tests show "Run 26/6" when FastCheck's shrinking algorithm is active.
 *
 * TODO: allow for upper timelimit instead of / additional to `numRuns`
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
      EnhancedTestContext,
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
  const normalizedPropOptions = normalizePropOptions(propOptions)
  const numRuns = normalizedPropOptions.fastCheck?.numRuns ?? 100
  let runIndex = 0
  let shrinkAttempts = 0
  let totalExecutions = 0

  return api.prop(
    name,
    arbitraries,
    (properties, ctx) => {
      if (ctx.signal.aborted) {
        return ctx.skip('Test aborted')
      }

      totalExecutions++
      const isInShrinkingPhase = runIndex >= numRuns

      if (isInShrinkingPhase) {
        shrinkAttempts++
      }

      const enhancedContext: EnhancedTestContext = isInShrinkingPhase
        ? {
            _tag: 'shrinking',
            numRuns,
            runIndex: runIndex++,
            shrinkAttempt: shrinkAttempts,
            totalExecutions,
          }
        : {
            _tag: 'initial',
            numRuns,
            runIndex: runIndex++,
            totalExecutions,
          }

      return test(properties, ctx, enhancedContext)
    },
    normalizedPropOptions,
  )
}
