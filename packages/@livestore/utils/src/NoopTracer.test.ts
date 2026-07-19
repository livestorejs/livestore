import { INVALID_SPAN_CONTEXT, isSpanContextValid, ROOT_CONTEXT } from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'

import { makeNoopSpan, makeNoopTracer } from './NoopTracer.ts'

describe('NoopTracer', () => {
  it('returns the canonical invalid OpenTelemetry span context', () => {
    const spanContext = makeNoopSpan().spanContext()

    expect(spanContext).toBe(INVALID_SPAN_CONTEXT)
    expect(isSpanContextValid(spanContext)).toBe(false)
  })

  it('runs active-span callbacks for every tracer overload', () => {
    const tracer = makeNoopTracer()
    expect(tracer.startActiveSpan('two arguments', () => 'two')).toBe('two')
    expect(tracer.startActiveSpan('three arguments', {}, () => 'three')).toBe('three')
    expect(tracer.startActiveSpan('four arguments', {}, ROOT_CONTEXT, () => 'four')).toBe('four')
  })
})
