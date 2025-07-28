import type { Effect, HttpClient, Option, Scope, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type { UnexpectedError } from '../adapter-types.ts'
import type { InitialSyncOptions } from '../leader-thread/types.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import type * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'

/**
 * Those arguments can be used to implement multi-tenancy etc and are passed in from the store.
 */
export type MakeBackendArgs = {
  storeId: string
  clientId: string
  payload: Schema.JsonValue | undefined
}

export type SyncOptions = {
  backend?: SyncBackendConstructor<any>
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
  /**
   * What to do if there is an error during sync.
   *
   * Options:
   * `shutdown` will stop the sync processor and cause the app to crash.
   * `ignore` will log the error and let the app continue running acting as if it was offline.
   *
   * @default 'ignore'
   * */
  onSyncError?: 'shutdown' | 'ignore'
}

// TODO rename to `SyncProviderClientConstructor`
export type SyncBackendConstructor<TSyncMetadata = Schema.JsonValue> = (
  args: MakeBackendArgs,
) => Effect.Effect<SyncBackend<TSyncMetadata>, UnexpectedError, Scope.Scope | HttpClient.HttpClient>

// TODO add more runtime sync metadata
// - latency histogram
// - number of events pushed/pulled
// - dynamic sync backend data;
//   - data center location (e.g. colo on CF workers)

// TODO rename to `SyncProviderClient`
export type SyncBackend<TSyncMetadata = Schema.JsonValue> = {
  /**
   * Can be implemented to prepare a connection to the sync backend to speed up the first pull/push.
   */
  connect: Effect.Effect<void, IsOfflineError | UnexpectedError, HttpClient.HttpClient | Scope.Scope>
  pull: (
    args: Option.Option<{
      cursor: EventSequenceNumber.EventSequenceNumber
      metadata: Option.Option<TSyncMetadata>
    }>,
  ) => Stream.Stream<
    {
      batch: ReadonlyArray<{
        eventEncoded: LiveStoreEvent.AnyEncodedGlobal
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
     * - sequence numbers must be in ascending order
     * */
    batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
  ) => Effect.Effect<void, IsOfflineError | InvalidPushError, HttpClient.HttpClient>
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  /**
   * Metadata describing the sync backend. (Currently only used by devtools.)
   */
  metadata: { name: string; description: string } & Record<string, Schema.JsonValue>
}

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {}) {}

// TODO gt rid of this error in favour of SyncError
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  reason: Schema.Union(
    Schema.TaggedStruct('Unexpected', {
      message: Schema.String,
    }),
    Schema.TaggedStruct('ServerAhead', {
      minimumExpectedNum: Schema.Number,
      providedNum: Schema.Number,
    }),
  ),
}) {}

// TODO gt rid of this error in favour of SyncError
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  message: Schema.String,
}) {}

// TODO gt rid of this error in favour of SyncError
export class LeaderAheadError extends Schema.TaggedError<LeaderAheadError>()('LeaderAheadError', {
  minimumExpectedNum: EventSequenceNumber.EventSequenceNumber,
  providedNum: EventSequenceNumber.EventSequenceNumber,
  /** Generation number the client session should use for subsequent pushes */
  // nextGeneration: Schema.Number,
}) {}
