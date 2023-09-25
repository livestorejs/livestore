/* eslint-disable prefer-arrow/prefer-arrow-functions */
import type * as otel from '@opentelemetry/api'

export const makeNoopSpan = () => {
  const performanceStartTime: DOMHighResTimeStamp = performance.now()

  const span = {
    _performanceStartTime: performanceStartTime,
    setAttribute: () => null,
    setAttributes: () => null,
    addEvent: () => null,
    setStatus: () => null,
    updateName: () => null,
    recordException: () => null,
    end: () => {
      const endTime: DOMHighResTimeStamp = performance.now()
      const duration = endTime - performanceStartTime
      const durationSecs = duration / 1000
      const durationRestNs = (duration % 1000) * 1_000_000
      ;(span as any)._duration = [durationSecs, durationRestNs]
    },
    spanContext: () => {
      return { traceId: 'noop-trace-id', spanId: 'noop-span-id' }
    },
    _duration: [0, 0],
  } as unknown as otel.Span

  return span
}

export const makeNoopTracer = () => {
  return new NoopTracer() as unknown as otel.Tracer
}

export class NoopTracer {
  startSpan = () => makeNoopSpan()

  startActiveSpan<F extends (span: otel.Span) => ReturnType<F>>(name: string, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: otel.Span) => ReturnType<F>>(
    name: string,
    opts: otel.SpanOptions,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: otel.Span) => ReturnType<F>>(
    name: string,
    opts: otel.SpanOptions,
    ctx: otel.Context,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: otel.Span) => ReturnType<F>>(
    name: string,
    arg2?: F | otel.SpanOptions,
    arg3?: F | otel.Context,
    arg4?: F,
  ): ReturnType<F> | undefined {
    let _opts: otel.SpanOptions | undefined
    let _ctx: otel.Context | undefined
    let fn: F

    if (arguments.length < 2) {
      return
    } else if (arguments.length === 2) {
      fn = arg2 as F
    } else if (arguments.length === 3) {
      _opts = arg2 as otel.SpanOptions | undefined
      fn = arg3 as F
    } else {
      _opts = arg2 as otel.SpanOptions | undefined
      _ctx = arg3 as otel.Context | undefined
      fn = arg4 as F
    }

    return fn(makeNoopSpan())
  }
}
