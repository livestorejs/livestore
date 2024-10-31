import type { Effect, HttpClient, Option, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'
import type { MutationEvent } from '../schema/mutations.js'

export interface SyncBackendOptionsBase {
  type: string
  [key: string]: Schema.JsonValue
}

export type SyncBackend<TSyncMetadata = Schema.JsonValue> = {
  pull: (
    args: Option.Option<{
      cursor: EventId
      metadata: Option.Option<TSyncMetadata>
    }>,
    options: { listenForNew: boolean },
  ) => Stream.Stream<
    {
      mutationEventEncoded: MutationEvent.AnyEncoded
      metadata: Option.Option<TSyncMetadata>
      persisted: boolean
    },
    IsOfflineError | InvalidPullError,
    HttpClient.HttpClient
  >
  // TODO support batching
  push: (
    mutationEventEncoded: MutationEvent.AnyEncoded,
    persisted: boolean,
  ) => Effect.Effect<
    { metadata: Option.Option<TSyncMetadata> },
    IsOfflineError | InvalidPushError,
    HttpClient.HttpClient
  >
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  message: Schema.String,
}) {}
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  message: Schema.String,
}) {}
