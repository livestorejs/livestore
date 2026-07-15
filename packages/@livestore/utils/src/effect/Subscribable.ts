// Fork of effect/Subscribable.ts which makes Subscribable yieldable

/**
 * @since 2.0.0
 */

import { Effect, Effectable, Function, Predicate, Stream, SubscriptionRef } from 'effect'

const ReadableTypeId: unique symbol = Symbol.for('effect/Readable')
type ReadableTypeId = typeof ReadableTypeId

interface Readable<A, E = never, R = never> {
  readonly [ReadableTypeId]: ReadableTypeId
  readonly get: Effect.Effect<A, E, R>
}

/**
 * @since 2.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for('effect/Subscribable')

/**
 * @since 2.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 2.0.0
 * @category models
 */
export interface Subscribable<A, E = never, R = never> extends Readable<A, E, R>, Effect.Effect<A, E, R> {
  readonly [TypeId]: TypeId
  readonly changes: Stream.Stream<A, E, R>
}

/**
 * @since 2.0.0
 * @category refinements
 */
export const isSubscribable = (u: unknown): u is Subscribable<unknown, unknown, unknown> =>
  Predicate.hasProperty(u, TypeId)

const Proto: Omit<Subscribable<unknown, unknown, unknown>, 'get' | 'changes'> = Object.assign(
  Effectable.Prototype<Subscribable<unknown, unknown, unknown>>({
    label: 'Subscribable',
    evaluate() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- vendored fork; this shared prototype is generic over all A, E, R, so `unknown` in the error/requirements channels is structural, not a real error type
      return this.get
    },
  }),
  {
    [ReadableTypeId]: ReadableTypeId,
    [TypeId]: TypeId,
  } as const,
)

/**
 * @since 2.0.0
 * @category constructors
 */
export const make = <A, E, R>(options: {
  readonly get: Effect.Effect<A, E, R>
  readonly changes: Stream.Stream<A, E, R>
}): Subscribable<A, E, R> => Object.assign(Object.create(Proto), options)

export const fromSubscriptionRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Subscribable<A> =>
  make({
    get: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
  })

/**
 * @since 2.0.0
 * @category combinators
 */
export const map: {
  /**
   * @since 2.0.0
   * @category combinators
   */
  <A, B>(f: (a: NoInfer<A>) => B): <E, R>(fa: Subscribable<A, E, R>) => Subscribable<B, E, R>
  /**
   * @since 2.0.0
   * @category combinators
   */
  <A, E, R, B>(self: Subscribable<A, E, R>, f: (a: NoInfer<A>) => B): Subscribable<B, E, R>
} = Function.dual(
  2,
  <A, E, R, B>(self: Subscribable<A, E, R>, f: (a: NoInfer<A>) => B): Subscribable<B, E, R> =>
    make({
      get: Effect.map(self.get, f),
      changes: Stream.map(self.changes, f),
    }),
)

/**
 * @since 2.0.0
 * @category combinators
 */
export const mapEffect: {
  /**
   * @since 2.0.0
   * @category combinators
   */
  <A, B, E2, R2>(
    f: (a: NoInfer<A>) => Effect.Effect<B, E2, R2>,
  ): <E, R>(fa: Subscribable<A, E, R>) => Subscribable<B, E | E2, R | R2>
  /**
   * @since 2.0.0
   * @category combinators
   */
  <A, E, R, B, E2, R2>(
    self: Subscribable<A, E, R>,
    f: (a: NoInfer<A>) => Effect.Effect<B, E2, R2>,
  ): Subscribable<B, E | E2, R | R2>
} = Function.dual(
  2,
  <A, E, R, B, E2, R2>(
    self: Subscribable<A, E, R>,
    f: (a: NoInfer<A>) => Effect.Effect<B, E2, R2>,
  ): Subscribable<B, E | E2, R | R2> =>
    make({
      get: Effect.flatMap(self.get, f),
      changes: Stream.mapEffect(self.changes, f),
    }),
)

/**
 * @since 2.0.0
 * @category constructors
 */
export const unwrap = <A, E, R, E1, R1>(
  effect: Effect.Effect<Subscribable<A, E, R>, E1, R1>,
): Subscribable<A, E | E1, R | R1> =>
  make({
    get: Effect.flatMap(effect, (s) => s.get),
    changes: Stream.unwrap(Effect.map(effect, (s) => s.changes)),
  })

export const never = make({
  get: Effect.never,
  changes: Stream.never,
})
