import { type Effect, Schema, type Stream, type SubscriptionRef } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/mutations.js'

export type SyncImpl = {
  pull: (cursor: string | undefined) => Stream.Stream<MutationEvent.AnyEncoded, IsOfflineError | InvalidPullError>
  pushes: Stream.Stream<MutationEvent.AnyEncoded>
  push: (mutationEvent: MutationEvent.AnyEncoded) => Effect.Effect<void, IsOfflineError | InvalidPushError>
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {}) {}
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {}) {}
