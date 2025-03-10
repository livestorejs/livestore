import { makeNoopTracer } from '@livestore/utils'
import { Effect, identity, Layer, OtelTracer } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

export const provideOtel =
  ({ otelTracer, parentSpanContext }: { otelTracer?: otel.Tracer; parentSpanContext?: otel.Context }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, OtelTracer.OtelTracer>> => {
    const OtelTracerLive = Layer.succeed(OtelTracer.OtelTracer, otelTracer ?? makeNoopTracer())

    const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
      Layer.provideMerge(OtelTracerLive),
    ) as any as Layer.Layer<OtelTracer.OtelTracer>

    return effect.pipe(
      parentSpanContext
        ? Effect.withParentSpan(OtelTracer.makeExternalSpan(otel.trace.getSpanContext(parentSpanContext)!))
        : identity,
      Effect.provide(TracingLive),
    )
  }

export const getDurationMsFromSpan = (span: otel.Span): number => {
  const durationHr: [seconds: number, nanos: number] = (span as any)._duration
  return durationHr[0] * 1000 + durationHr[1] / 1_000_000
}

export const getStartTimeHighResFromSpan = (span: otel.Span): DOMHighResTimeStamp =>
  (span as any)._performanceStartTime as DOMHighResTimeStamp
