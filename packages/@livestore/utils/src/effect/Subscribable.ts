// Fork of effect/Subscribable.ts which makes Subscribable yieldable

/**
 * @since 2.0.0
 */

import type { SubscriptionRef } from 'effect'
import { Effect, Effectable, Readable, Stream } from 'effect'
import { dual } from 'effect/Function'
import { hasProperty } from 'effect/Predicate'

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
export interface Subscribable<A, E = never, R = never> extends Readable.Readable<A, E, R>, Effect.Effect<A, E, R> {
  readonly [TypeId]: TypeId
  readonly changes: Stream.Stream<A, E, R>
}

/**
 * @since 2.0.0
 * @category refinements
 */
export const isSubscribable = (u: unknown): u is Subscribable<unknown, unknown, unknown> => hasProperty(u, TypeId)

// const Proto: Omit<Subscribable<any>, 'get' | 'changes'> = {
//   [Readable.TypeId]: Readable.TypeId,
//   [TypeId]: TypeId,
//   pipe() {
//     return pipeArguments(this, arguments)
//   },
// }

class SubscribableImpl<in out A> extends Effectable.Class<A> implements Subscribable<A> {
  // @ts-expect-error type symbol
  readonly [TypeId] = TypeId
  // @ts-expect-error type symbol
  readonly [Readable.TypeId] = Readable.TypeId
  readonly get: Effect.Effect<A>
  readonly changes: Stream.Stream<A>
  constructor(
    get: Effect.Effect<A>,
    changes: Stream.Stream<A>,
  ) {
    super()
    this.get = get
    this.changes = changes
  }

  commit() {
    return this.get
  }
}

/**
 * @since 2.0.0
 * @category constructors
 */
// export const make = <A, E, R>(options: {
//   readonly get: Effect.Effect<A, E, R>
//   readonly changes: Stream.Stream<A, E, R>
// }): Subscribable<A, E, R> => Object.assign(Object.create(Proto), options)

export const make = <A, E, R>(options: {
  readonly get: Effect.Effect<A, E, R>
  readonly changes: Stream.Stream<A, E, R>
}): Subscribable<A, E, R> => new SubscribableImpl(options.get as any, options.changes as any) as Subscribable<A, E, R>

export const fromSubscriptionRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Subscribable<A> =>
  make({
    get: ref.get,
    changes: ref.changes,
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
} = dual(
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
} = dual(
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
