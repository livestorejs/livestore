import * as Context from '@effect/data/Context'
import { pipe } from '@effect/data/Function'
import * as Option from '@effect/data/Option'
import * as Cause from '@effect/io/Cause'
import * as Effect from '@effect/io/Effect'
import * as Exit from '@effect/io/Exit'
import * as Layer from '@effect/io/Layer'
import * as Stream from '@effect/stream/Stream'
import * as otel from '@opentelemetry/api'

import { Tracer } from './Tracer.js'

export const SpanSymbol = Symbol.for('effect-otel/Span')
export type SpanSymbol = typeof SpanSymbol

// TODO refactor to use 2nd `Context.Tag` type generic instead of symbol
export interface Span {
  readonly [SpanSymbol]: SpanSymbol
  readonly span: otel.Span
}

export const Span = Context.Tag<Span>(SpanSymbol)

export const makeSpan = (span: otel.Span): Span => ({
  [SpanSymbol]: SpanSymbol,
  span,
})

export const requireParentSpan = <R, E, A>(effect: Effect.Effect<R, E, A>): Effect.Effect<R | Span, E, A> => effect

export const activeSpanContext: Effect.Effect<Span, never, otel.SpanContext> = Effect.map(Span, (_) =>
  _.span.spanContext(),
)

export const activeContext: Effect.Effect<Span, never, otel.Context> = Effect.flatMap(Span, (_) =>
  Effect.sync(() => otel.trace.setSpan(otel.context.active(), _.span)),
)

// TODO get rid of this
const inProgressSpans = new Set<otel.Span>()
// @ts-expect-error `inProgressSpans` is not a global variable
globalThis.inProgressSpans = inProgressSpans

// TODO get rid of this
export const endInProgressSpans = Effect.sync(() => {
  inProgressSpans.forEach((span) => span.end())
  inProgressSpans.clear()
})

const startSpan = (
  tracer: otel.Tracer,
  context: Context.Context<never>,
  name: string,
  options: otel.SpanOptions | undefined,
  ctx: otel.Context | undefined,
): otel.Span => {
  let span: otel.Span
  const maybeSpan = Context.getOption(context, Span)
  if (ctx !== undefined) {
    span = tracer.startSpan(name, options, ctx)
  } else if (options?.root !== true && Option.isSome(maybeSpan)) {
    const ctx = otel.trace.setSpan(otel.context.active(), maybeSpan.value.span)
    span = tracer.startSpan(name, options, ctx)
  } else {
    span = tracer.startSpan(name, { ...options, root: true })
  }
  inProgressSpans.add(span)
  return span
}

const handleExit = <E, A>(span: otel.Span, exit: Exit.Exit<E, A>) =>
  Effect.sync(() => {
    if (Exit.isFailure(exit)) {
      if (Cause.isInterruptedOnly(exit.cause)) {
        // TODO in the future set a special status code for interruption (once Otel supports it)
        span.setStatus({ code: otel.SpanStatusCode.OK, message: Cause.pretty(exit.cause) })
        // NOTE as a workaround we're using the `span.label` attribute which is visible in Grafana
        // See https://github.com/grafana/grafana/pull/50931
        span.setAttribute('span.label', '⚠️ Interrupted️')
      } else {
        span.setStatus({ code: otel.SpanStatusCode.ERROR, message: Cause.pretty(exit.cause) })
      }
    } else {
      span.setStatus({ code: otel.SpanStatusCode.OK })
    }
    inProgressSpans.delete(span)
    span.end()
  })

export const withSpan =
  (name: string, options?: otel.SpanOptions, ctx?: otel.Context) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>): Effect.Effect<Exclude<R, Span> | Tracer, E, A> =>
    Effect.flatMap(Tracer, (tracer) =>
      Effect.acquireUseRelease(
        Effect.flatMap(Effect.context<never>(), (context) =>
          Effect.sync(() => startSpan(tracer.tracer, context, name, options, ctx)),
        ),
        (span) => Effect.provideService(effect, Span, makeSpan(span)),
        handleExit,
      ),
    )

export const withSpanScoped =
  (name: string, options?: otel.SpanOptions, ctx?: otel.Context) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>) =>
    Effect.flatMap(Tracer, (tracer) => {
      const createSpan = Effect.acquireRelease(
        Effect.flatMap(Effect.context<never>(), (context) =>
          Effect.sync(() => startSpan(tracer.tracer, context, name, options, ctx)),
        ),
        handleExit,
      )

      return Effect.flatMap(createSpan, (span) => Effect.provideService(effect, Span, makeSpan(span)))
    })

export const withSpanStream =
  (name: string, options?: otel.SpanOptions, ctx?: otel.Context) =>
  <R, E, A>(stream: Stream.Stream<R | Span, E, A>): Stream.Stream<Exclude<R, Span> | Tracer, E, A> =>
    Stream.unwrapScoped(
      Effect.flatMap(Tracer, (tracer) =>
        pipe(
          Effect.acquireRelease(
            Effect.flatMap(Effect.context<never>(), (context) =>
              Effect.sync(() => startSpan(tracer.tracer, context, name, options, ctx)),
            ),
            handleExit,
          ),
          Effect.map((span) => Stream.provideService(stream, Span, makeSpan(span))),
        ),
      ),
    )

// TODO add optional arg for `Tag` of `Span`
export const spanLayer: {
  (
    name: string,
    options?: otel.SpanOptions,
    ctx?: otel.Context,
    afterEnded?: (span: otel.Span) => Effect.Effect<never, never, void>,
  ): Layer.Layer<Tracer, never, Span>
  <TIdentifier>(
    name: string,
    options: otel.SpanOptions | undefined,
    ctx: otel.Context | undefined,
    afterEnded: ((span: otel.Span) => Effect.Effect<never, never, void>) | undefined,
    tag: Context.Tag<TIdentifier, Span>,
  ): Layer.Layer<Tracer, never, TIdentifier>
} = <TIdentifier>(
  name: string,
  options?: otel.SpanOptions,
  ctx?: otel.Context,
  afterEnded?: (span: otel.Span) => Effect.Effect<never, never, void>,
  tag?: Context.Tag<TIdentifier, Span>,
): Layer.Layer<Tracer, never, TIdentifier> =>
  Layer.flatMap(Layer.context<Tracer>(), (context) =>
    Layer.scoped(
      tag ?? Span,
      pipe(
        Effect.sync(() => {
          const tracer = Context.get(context, Tracer)
          return startSpan(tracer.tracer, context, name, options, ctx)
        }),
        Effect.map(makeSpan),
        Effect.acquireRelease(({ span }, exit) =>
          pipe(
            handleExit(span, exit),
            Effect.tap(() => {
              if (afterEnded !== undefined) {
                return afterEnded(span)
              }
              return Effect.unit
            }),
          ),
        ),
      ),
    ),
  )

export const spanLayerFromContext = (parentSpanCtx: otel.Context) => {
  // const _spanId = otel.trace.getSpan(parentSpanCtx)!.spanContext().spanId
  return Layer.succeed(Span, makeSpan(otel.trace.getSpan(parentSpanCtx)!))
}

export const withSpanLayer =
  (name: string, options?: otel.SpanOptions, ctx?: otel.Context) =>
  <R, E, A>(layer: Layer.Layer<R | Span, E, A>): Layer.Layer<Tracer | Exclude<R, Span>, E, A> =>
    Layer.provide(spanLayer(name, options, ctx), layer)

export const addAttribute = (name: string, value: otel.AttributeValue) =>
  Effect.flatMap(Span, ({ span }) =>
    Effect.sync(() => {
      span.setAttribute(name, value)
    }),
  )

export const addAttributes = (attributes: otel.Attributes) =>
  Effect.flatMap(Span, ({ span }) =>
    Effect.sync(() => {
      span.setAttributes(attributes)
    }),
  )

export const addAttributesEffect = <R, E>(attributes: Effect.Effect<R, E, otel.Attributes>) =>
  Effect.flatMap(attributes, (attributes) =>
    Effect.flatMap(Span, ({ span }) =>
      Effect.sync(() => {
        span.setAttributes(attributes)
      }),
    ),
  )

export const addEvent = (
  name: string,
  attributesOrStartTime?: otel.SpanAttributes | otel.TimeInput,
  startTime?: otel.TimeInput,
) =>
  Effect.flatMap(Span, ({ span }) =>
    Effect.sync(() => {
      span.addEvent(name, attributesOrStartTime, startTime)
    }),
  )
