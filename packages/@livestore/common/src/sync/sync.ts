import { type Effect, Schema, type Stream, type SubscriptionRef } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/mutations.js'

export type SyncImpl = {
  // TODO consider unifying `pull` and `pushed` into a single stream with a "marker event" after the initial loading is completed
  pull: (cursor: string | undefined) => Stream.Stream<MutationEvent.AnyEncoded, IsOfflineError | InvalidPullError>
  pushes: Stream.Stream<{ mutationEventEncoded: MutationEvent.AnyEncoded; persisted: boolean }>
  push: (
    mutationEventEncoded: MutationEvent.AnyEncoded,
    persisted: boolean,
  ) => Effect.Effect<void, IsOfflineError | InvalidPushError>
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  message: Schema.String,
}) {}
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  message: Schema.String,
}) {}
