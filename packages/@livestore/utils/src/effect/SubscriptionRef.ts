import { Chunk, Effect, pipe, Stream, SubscriptionRef } from 'effect'
import { dual } from 'effect/Function'
import type { Predicate, Refinement } from 'effect/Predicate'

export * from 'effect/SubscriptionRef'

export const changeStreamIncludingCurrent = <A>(sref: SubscriptionRef.SubscriptionRef<A>) =>
  pipe(Stream.fromEffect(SubscriptionRef.get(sref)), Stream.concat(sref.changes))

export const waitUntil: {
  <A, B extends A>(
    refinement: Refinement<NoInfer<A>, B>,
  ): (sref: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<B, never, never>
  <A, B extends A>(
    predicate: Predicate<B>,
  ): (sref: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<A, never, never>
  <A, B extends A>(
    sref: SubscriptionRef.SubscriptionRef<A>,
    refinement: Refinement<NoInfer<A>, B>,
  ): Effect.Effect<B, never, never>
  <A, B extends A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: Predicate<B>): Effect.Effect<A, never, never>
} = dual(2, <A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: (a: A) => boolean) =>
  pipe(
    changeStreamIncludingCurrent(sref),
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runCollect,
    Effect.map(Chunk.unsafeHead),
  ),
)
