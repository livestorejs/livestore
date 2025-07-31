import type { Effect, HttpClient, Option, Schema, Scope, Stream, SubscriptionRef } from '@livestore/utils/effect'
import type { UnexpectedError } from '../adapter-types.ts'
import type * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'
import type { EventSequenceNumber } from '../schema/mod.ts'
import type { InvalidPullError, InvalidPushError, IsOfflineError } from './errors.ts'

/**
 * Those arguments can be used to implement multi-tenancy etc and are passed in from the store.
 */
export type MakeBackendArgs = {
  storeId: string
  clientId: string
  payload: Schema.JsonValue | undefined
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
  ) => Stream.Stream<PullResItem<TSyncMetadata>, IsOfflineError | InvalidPullError, HttpClient.HttpClient>
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

export interface PullResItem<TSyncMetadata = Schema.JsonValue> {
  batch: ReadonlyArray<{
    eventEncoded: LiveStoreEvent.AnyEncodedGlobal
    metadata: Option.Option<TSyncMetadata>
  }>
  remaining: number
}

export const of = <TSyncMetadata = Schema.JsonValue>(obj: SyncBackend<TSyncMetadata>) => obj
