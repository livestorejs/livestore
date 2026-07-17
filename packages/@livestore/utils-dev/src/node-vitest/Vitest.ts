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
  Schema,
  type Scope,
} from '@livestore/utils/effect'
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
type ArbitraryValues<Arbs extends Vitest.Vitest.Arbitraries> = {
  [K in keyof Arbs]: Arbs[K] extends FC.Arbitrary<infer T> ? T : Arbs[K] extends Schema.Schema<infer T> ? T : never
}

type PropOptions<Arbs extends Vitest.Vitest.Arbitraries> = Omit<Vitest.TestOptions, 'fastCheck'> & {
  fastCheck?: FC.Parameters<ArbitraryValues<Arbs>>
}

const normalizePropOptions = <Arbs extends Vitest.Vitest.Arbitraries>(
  propOptions: number | PropOptions<Arbs>,
): PropOptions<Arbs> => {
  // If it's a number, treat as timeout and add our default fastCheck
  if (Predicate.isObject(propOptions) === false) {
    return {
      timeout: propOptions,
      fastCheck: { numRuns: 100 },
    }
  }

  // If no fastCheck property, add it with our default numRuns
  if (propOptions.fastCheck == null) {
    return {
      ...propOptions,
      fastCheck: { numRuns: 100 },
    }
  }

  // If fastCheck exists but no numRuns, add our default
  if (propOptions.fastCheck !== undefined && propOptions.fastCheck.numRuns == null) {
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
  test: Vitest.Vitest.TestFunction<A, E, R, [ArbitraryValues<Arbs>, Vitest.TestContext, EnhancedTestContext]>,
  propOptions: number | PropOptions<Arbs>,
) => {
  const normalizedPropOptions = normalizePropOptions(propOptions)
  const normalizedArbitraries = normalizeArbitraries(arbitraries)
  const numRuns = normalizedPropOptions.fastCheck?.numRuns ?? 100
  let runIndex = 0
  let shrinkAttempts = 0
  let totalExecutions = 0

  return api.prop(
    name,
    normalizedArbitraries,
    (properties, ctx) => {
      if (ctx.signal.aborted === true) {
        return ctx.skip('Test aborted')
      }

      totalExecutions++
      const isInShrinkingPhase = runIndex >= numRuns

      if (isInShrinkingPhase === true) {
        shrinkAttempts++
      }

      const enhancedContext: EnhancedTestContext =
        isInShrinkingPhase === true
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

/**
 * Work around Effect-TS/effect#6413 until `@effect/vitest` converts schemas in
 * record-form property definitions instead of passing them to FastCheck unchanged.
 */
const normalizeArbitraries = <Arbs extends Vitest.Vitest.Arbitraries>(arbitraries: Arbs): Arbs => {
  if (Array.isArray(arbitraries) === true) return arbitraries

  const normalized = Object.fromEntries(
    Object.entries(arbitraries).map(([key, arbitrary]) => [
      key,
      Schema.isSchema(arbitrary) === true ? Schema.toArbitrary(arbitrary) : arbitrary,
    ]),
  )

  // Normalization preserves record keys and value output types while replacing
  // schema values with their equivalent FastCheck arbitraries.
  return normalized as unknown as Arbs
}
