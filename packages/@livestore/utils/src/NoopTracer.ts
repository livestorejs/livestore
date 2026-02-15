/** biome-ignore-all lint/complexity/noArguments: using arguments is fine here */

import type * as otel from '@opentelemetry/api'

import { cuid } from '@livestore/utils/cuid'

export const makeNoopSpan = () => {
  const performanceStartTime = performance.now()

  const spanImpl = {
    _performanceStartTime: performanceStartTime,
    setAttribute: () => null,
    setAttributes: () => null,
    addEvent: () => null,
    addLink: () => null,
    setStatus: () => null,
    updateName: () => null,
    recordException: () => null,
    end: () => {
      const endTime = performance.now()
      const duration = endTime - performanceStartTime
      const durationSecs = duration / 1000
      const durationRestNs = (duration % 1000) * 1_000_000
      spanImpl._duration = [durationSecs, durationRestNs] as [number, number]
    },
    spanContext: () => {
      return {
        traceId: `livestore-noop-trace-id${cuid()}`,
        spanId: `livestore-noop-span-id${cuid()}`,
      }
    },
    _duration: [0, 0] as [number, number],
  }

  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- noop otel.Span implementation; only implements the subset needed by LiveStore
  return spanImpl as unknown as otel.Span
}

export const makeNoopTracer = () => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- noop otel.Tracer implementation; only implements the subset needed by LiveStore
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
    _name: string,
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
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 2 args, arg2 is the callback
      fn = arg2 as F
    } else if (arguments.length === 3) {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 3 args, arg2 is SpanOptions
      _opts = arg2 as otel.SpanOptions | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 3 args, arg3 is the callback
      fn = arg3 as F
    } else {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg2 is SpanOptions
      _opts = arg2 as otel.SpanOptions | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg3 is Context
      _ctx = arg3 as otel.Context | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg4 is the callback
      fn = arg4 as F
    }

    return fn(makeNoopSpan())
  }
}
