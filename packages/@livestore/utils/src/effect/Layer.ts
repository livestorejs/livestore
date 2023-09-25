export * from '@effect/io/Layer'
import type * as Context from '@effect/data/Context'
import { pipe } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as Tracer from '@effect/io/Tracer'

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
