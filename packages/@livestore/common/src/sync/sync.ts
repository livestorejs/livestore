import type { Effect, HttpClient, Option, Scope, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type { UnexpectedError } from '../adapter-types.js'
import type { InitialSyncOptions } from '../leader-thread/types.js'
import * as EventId from '../schema/EventId.js'
import type * as MutationEvent from '../schema/MutationEvent.js'

/**
 * Those arguments can be used to implement multi-tenancy etc and are passed in from the store.
 */
export type MakeBackendArgs = {
  storeId: string
  clientId: string
}

export type SyncOptions = {
  makeBackend: (args: MakeBackendArgs) => Effect.Effect<SyncBackend<any>, UnexpectedError, Scope.Scope>
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
}

export type SyncBackend<TSyncMetadata = Schema.JsonValue> = {
  pull: (
    args: Option.Option<{
      cursor: EventId.EventId
      metadata: Option.Option<TSyncMetadata>
    }>,
  ) => Stream.Stream<
    {
      batch: ReadonlyArray<{
        mutationEventEncoded: MutationEvent.AnyEncodedGlobal
        metadata: Option.Option<TSyncMetadata>
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
    batch: ReadonlyArray<MutationEvent.AnyEncodedGlobal>,
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

export class LeaderAheadError extends Schema.TaggedError<LeaderAheadError>()('LeaderAheadError', {
  minimumExpectedId: EventId.EventId,
  providedId: EventId.EventId,
  /** Generation number the client session should use for subsequent pushes */
  // nextGeneration: Schema.Number,
}) {}
