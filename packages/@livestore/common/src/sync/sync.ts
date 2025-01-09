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
  ) => Stream.Stream<
    {
      batch: ReadonlyArray<{
        mutationEventEncoded: MutationEvent.AnyEncoded
        metadata: Option.Option<TSyncMetadata>
        persisted: boolean
      }>
      remaining: number
    },
    IsOfflineError | InvalidPullError,
    HttpClient.HttpClient
  >
  // TODO support transactions (i.e. group of mutation events which need to be applied together)
  push: (
    /**
     * Constraints for batch:
     * - Number of events: 1-100
     * - event ids must be in ascending order
     * */
    batch: ReadonlyArray<MutationEvent.AnyEncoded>,
    persisted: boolean,
  ) => Effect.Effect<
    {
      /** Indexes are relative to `batch` */
      metadata: ReadonlyArray<Option.Option<TSyncMetadata>>
    },
    IsOfflineError | InvalidPushError,
    HttpClient.HttpClient
  >
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  reason: Schema.Union(
    Schema.TaggedStruct('Unexpected', {
      message: Schema.String,
    }),
    Schema.TaggedStruct('ServerAhead', {
      minimumExpectedId: Schema.Number,
      providedId: Schema.Number,
    }),
  ),
}) {}
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  message: Schema.String,
}) {}
