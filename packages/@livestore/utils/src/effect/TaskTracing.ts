import { Predicate } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
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
          const maybeParentSpan = Context.getOption(fiber.context, Tracer.ParentSpan)

          if (maybeParentSpan._tag === 'None') return oldTracer.context?.(f, fiber) ?? (f as any)
          const parentSpan = maybeParentSpan.value
          if (parentSpan._tag === 'ExternalSpan') return oldTracer.context?.(f, fiber) ?? (f as any)
          const span = parentSpan
          if ('runInTask' in span && typeof span.runInTask === 'function') {
            return span.runInTask(() => oldTracer.context?.(f, fiber) ?? (f as any))
          }

          return oldTracer.context?.(f, fiber) ?? (f as any)
        },
      })
    })

    const withTracerLayer = Layer.effect(Tracer.Tracer, makeTracer)

    return Effect.provide(eff, withTracerLayer)
  }
