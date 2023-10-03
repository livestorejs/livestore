export * from 'effect/Layer'
import type { Context, Tracer } from 'effect'
import { Effect, Layer, pipe } from 'effect'

export const span = (
  name: string,
  options?: {
    readonly attributes?: Record<string, Tracer.AttributeValue>
    readonly links?: ReadonlyArray<Tracer.SpanLink>
    readonly parent?: Tracer.ParentSpan
    readonly root?: boolean
    readonly context?: Context.Context<never>
  },
  onEnd?: (span: Tracer.Span) => Effect.Effect<never, never, void>,
): Layer.Layer<never, never, never> => {
  const scopedEffect = pipe(
    // eslint-disable-next-line react-hooks/rules-of-hooks
    Effect.useSpanScoped(name, options),
    Effect.tap((span) => Effect.withParentSpanScoped(span)),
    Effect.tap((span) => (onEnd ? Effect.addFinalizer(() => onEnd(span)) : Effect.unit)),
  )

  return Layer.scopedDiscard(scopedEffect)
}

export const withSpan =
  (
    name: string,
    options?: {
      readonly attributes?: Record<string, Tracer.AttributeValue>
      readonly links?: ReadonlyArray<Tracer.SpanLink>
      readonly parent?: Tracer.ParentSpan
      readonly root?: boolean
      readonly context?: Context.Context<never>
    },
    onEnd?: (span: Tracer.Span) => Effect.Effect<never, never, void>,
  ) =>
  <C, E, A>(layer: Layer.Layer<C, E, A>): Layer.Layer<C, E, A> =>
    Layer.provideMerge(span(name, options, onEnd), layer)
