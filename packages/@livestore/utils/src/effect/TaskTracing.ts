import { Context, Effect, Layer, Predicate, Tracer } from 'effect'

export const withAsyncTaggingTracing =
  (makeTrace: (name: string) => { run: (fn: any) => any }) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>) => {
    if (Predicate.hasProperty(console, 'createTask') === false) {
      return eff
    }

    const makeTracer = Effect.gen(function* () {
      const oldTracer = yield* Effect.tracer
      const evaluate = <X>(primitive: Tracer.EffectPrimitive<X>, fiber: any) =>
        oldTracer.context?.(primitive, fiber) ?? primitive['~effect/Effect/evaluate'](fiber)
      return Tracer.make({
        span: (options) => {
          const span = oldTracer.span(options)
          const trace = makeTrace(options.name)
          ;(span as any).runInTask = (f: any) => trace.run(f)
          return span
        },
        context: (primitive, fiber) => {
          const maybeParentSpan = Context.getOption(fiber.context, Tracer.ParentSpan)

          if (maybeParentSpan._tag === 'None') return evaluate(primitive, fiber)
          const parentSpan = maybeParentSpan.value
          if (parentSpan._tag === 'ExternalSpan') return evaluate(primitive, fiber)
          const span = parentSpan
          if ('runInTask' in span && typeof span.runInTask === 'function') {
            return span.runInTask(() => evaluate(primitive, fiber))
          }

          return evaluate(primitive, fiber)
        },
      })
    })

    const withTracerLayer = Layer.effect(Tracer.Tracer, makeTracer)

    return Effect.provide(eff, withTracerLayer)
  }
