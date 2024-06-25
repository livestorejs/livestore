import type { Effect } from 'effect'
import { pipe, Stream, SubscriptionRef } from 'effect'
import { dual } from 'effect/Function'

export * from 'effect/SubscriptionRef'

export const changeStreamIncludingCurrent = <A>(sref: SubscriptionRef.SubscriptionRef<A>) =>
  pipe(Stream.fromEffect(SubscriptionRef.get(sref)), Stream.concat(sref.changes))

export const waitUntil = dual<
  <A>(predicate: (a: A) => boolean) => (sref: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<void>,
  <A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: (a: A) => boolean) => Effect.Effect<void>
>(2, <A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: (a: A) => boolean) =>
  pipe(changeStreamIncludingCurrent(sref), Stream.filter(predicate), Stream.take(1), Stream.runDrain),
)
