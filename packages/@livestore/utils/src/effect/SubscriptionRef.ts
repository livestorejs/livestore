import { pipe, Stream, SubscriptionRef } from 'effect'

export * from 'effect/SubscriptionRef'

export const changeStreamIncludingCurrent = <A>(sref: SubscriptionRef.SubscriptionRef<A>) =>
  pipe(Stream.fromEffect(SubscriptionRef.get(sref)), Stream.concat(sref.changes))
