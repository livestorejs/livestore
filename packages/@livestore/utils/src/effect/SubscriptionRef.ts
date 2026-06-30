import { Effect, Function, pipe, Stream, SubscriptionRef, type Predicate } from 'effect'

export * from 'effect/SubscriptionRef'

export const waitUntil: {
  <A, B extends A>(
    refinement: Predicate.Refinement<NoInfer<A>, B>,
  ): (sref: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<B>
  <A, B extends A>(predicate: Predicate.Predicate<B>): (sref: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<A>
  <A, B extends A>(
    sref: SubscriptionRef.SubscriptionRef<A>,
    refinement: Predicate.Refinement<NoInfer<A>, B>,
  ): Effect.Effect<B>
  <A, B extends A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: Predicate.Predicate<B>): Effect.Effect<A>
} = Function.dual(2, <A>(sref: SubscriptionRef.SubscriptionRef<A>, predicate: (a: A) => boolean) =>
  pipe(SubscriptionRef.changes(sref), Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption)),
)

export const fromStream = <A>(stream: Stream.Stream<A>, initialValue: A) =>
  Effect.gen(function* () {
    const sref = yield* SubscriptionRef.make(initialValue)

    yield* stream.pipe(
      Stream.tap((a) => SubscriptionRef.set(sref, a)),
      Stream.runDrain,
      // TODO(#1356): These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
      Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
    )

    return sref
  })
