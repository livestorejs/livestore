import { makeExternalSpan } from '@effect/opentelemetry/Tracer'
import type { Link as OtelSpanLink } from '@opentelemetry/api'
import type { SpanLink as EffectSpanLink } from 'effect/Tracer'

export * from '@effect/opentelemetry/Tracer'

export const makeSpanLink = (otelSpanLink: OtelSpanLink): EffectSpanLink => ({
  _tag: 'SpanLink',
  span: makeExternalSpan(otelSpanLink.context),
  attributes: otelSpanLink.attributes ?? {},
})
