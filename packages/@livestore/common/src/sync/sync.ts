import type { Effect, Option, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/mutations.js'

export interface SyncBackendOptionsBase {
  type: string
  [key: string]: Schema.JsonValue
}

export type SyncBackend<TSyncMetadata = Schema.JsonValue> = {
  pull: (
    args: Option.Option<{
      cursor: string
      metadata: Option.Option<TSyncMetadata>
    }>,
    options: { listenForNew: boolean },
  ) => Stream.Stream<
    {
      mutationEventEncoded: MutationEvent.AnyEncoded
      metadata: Option.Option<TSyncMetadata>
      persisted: boolean
    },
    IsOfflineError | InvalidPullError
  >
  // TODO support batching
  push: (
    mutationEventEncoded: MutationEvent.AnyEncoded,
    persisted: boolean,
  ) => Effect.Effect<{ metadata: Option.Option<TSyncMetadata> }, IsOfflineError | InvalidPushError>
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  message: Schema.String,
}) {}
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  message: Schema.String,
}) {}
