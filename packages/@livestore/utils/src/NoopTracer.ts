import { INVALID_SPAN_CONTEXT, type Context, type Span, type SpanOptions, type Tracer } from '@opentelemetry/api'

export const makeNoopSpan = () => {
  const spanImpl = {
    setAttribute: () => null,
    setAttributes: () => null,
    addEvent: () => null,
    addLink: () => null,
    setStatus: () => null,
    updateName: () => null,
    recordException: () => null,
    end: () => null,
    spanContext: () => INVALID_SPAN_CONTEXT,
  }

  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- noop otel.Span implementation; only implements the subset needed by LiveStore
  return spanImpl as unknown as Span
}

export const makeNoopTracer = () => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- noop otel.Tracer implementation; only implements the subset needed by LiveStore
  return new NoopTracer() as unknown as Tracer
}

export class NoopTracer {
  startSpan = () => makeNoopSpan()

  startActiveSpan<F extends (span: Span) => ReturnType<F>>(name: string, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(name: string, opts: SpanOptions, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    opts: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    _name: string,
    arg2?: F | SpanOptions,
    arg3?: F | Context,
    arg4?: F,
  ): ReturnType<F> | undefined {
    let _opts: SpanOptions | undefined
    let _ctx: Context | undefined
    let fn: F

    if (arguments.length < 2) {
      return
    } else if (arguments.length === 2) {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 2 args, arg2 is the callback
      fn = arg2 as F
    } else if (arguments.length === 3) {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 3 args, arg2 is SpanOptions
      _opts = arg2 as SpanOptions | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 3 args, arg3 is the callback
      fn = arg3 as F
    } else {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg2 is SpanOptions
      _opts = arg2 as SpanOptions | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg3 is Context
      _ctx = arg3 as Context | undefined
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- arguments-based overload dispatch: with 4 args, arg4 is the callback
      fn = arg4 as F
    }

    return fn(makeNoopSpan())
  }
}
