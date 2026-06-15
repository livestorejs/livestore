import { Predicate } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type * as Fiber from 'effect/Fiber'
import * as Tracer from 'effect/Tracer'

export const withAsyncTaggingTracing =
  (makeTrace: (name: string) => { run: (fn: any) => any }) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>) => {
    if (Predicate.hasProperty(console, 'createTask') === false) {
      return eff
    }

    const makeTracer = Effect.gen(function* () {
      const oldTracer = yield* Effect.tracer
      return Tracer.make({
        span: (options) => {
          const span = oldTracer.span(options)
          const trace = makeTrace(options.name)
          ;(span as any).runInTask = (f: any) => trace.run(f)
          return span
        },
        context: (f, fiber) => {
          const oldContext = oldTracer.context ?? evaluatePrimitive
          const maybeParentSpan = Context.getOption(Tracer.ParentSpan)(fiber.context)

          if (maybeParentSpan._tag === 'None') return oldContext(f, fiber)
          const parentSpan = maybeParentSpan.value
          if (parentSpan._tag === 'ExternalSpan') return oldContext(f, fiber)
          const span = parentSpan
          if ('runInTask' in span && typeof span.runInTask === 'function') {
            return span.runInTask(() => oldContext(f, fiber))
          }

          return oldContext(f, fiber)
        },
      })
    })

    return Effect.flatMap(makeTracer, (tracer) => Effect.withTracer(eff, tracer))
  }

const evaluatePrimitive = <A>(primitive: Tracer.EffectPrimitive<A>, fiber: Fiber.Fiber<any, any>): A =>
  (
    primitive as Tracer.EffectPrimitive<A> & {
      readonly '~effect/Effect/evaluate': (fiber: Fiber.Fiber<any, any>) => A
    }
  )['~effect/Effect/evaluate'](fiber)
