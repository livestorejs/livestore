import {
  type Cause,
  type Effect,
  type HttpClient,
  Option,
  Schema,
  type Scope,
  type Stream,
  type SubscriptionRef,
} from '@livestore/utils/effect'
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

// TODO add more runtime sync metadata/metrics
// - latency histogram
// - number of events pushed/pulled
// - dynamic sync backend data;
//   - data center location (e.g. colo on CF workers)

// TODO rename to `SyncProviderClient`
export type SyncBackend<TSyncMetadata = Schema.JsonValue> = {
  /**
   * Can be implemented to prepare a connection to the sync backend to speed up the first pull/push.
   */
  connect: Effect.Effect<void, IsOfflineError | UnexpectedError, Scope.Scope>
  pull: (
    args: Option.Option<{
      cursor: EventSequenceNumber.GlobalEventSequenceNumber
      /** Metadata is needed by some sync backends */
      metadata: Option.Option<TSyncMetadata>
    }>,
    options?: {
      /**
       * If true, the sync backend will return a stream of events that have been pushed after the cursor.
       *
       * @default false
       */
      live?: boolean
    },
  ) => Stream.Stream<PullResItem<TSyncMetadata>, IsOfflineError | InvalidPullError>
  // TODO support transactions (i.e. group of mutation events which need to be applied together)
  push: (
    /**
     * Constraints for batch:
     * - Number of events: 1-100
     * - sequence numbers must be in ascending order
     * */
    batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
  ) => Effect.Effect<void, IsOfflineError | InvalidPushError>
  ping: Effect.Effect<void, IsOfflineError | UnexpectedError | Cause.TimeoutException>
  // TODO also expose latency information additionally to whether the backend is connected
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  /**
   * Metadata describing the sync backend. (Currently only used by devtools.)
   */
  metadata: { name: string; description: string } & Record<string, Schema.JsonValue>
  /** Information about the sync backend capabilities. */
  supports: {
    /**
     * Whether the sync backend supports the `hasMore` field in the pull response.
     */
    pullPageInfoKnown: boolean
    /**
     * Whether the sync backend supports the `live` option for the pull method and thus
     * long-lived, reactive pull streams.
     */
    pullLive: boolean
  }
}

export const PullResPageInfo = Schema.Union(
  Schema.TaggedStruct('MoreUnknown', {}),
  Schema.TaggedStruct('MoreKnown', {
    remaining: Schema.Number,
  }),
  Schema.TaggedStruct('NoMore', {}),
)

export type PullResPageInfo = typeof PullResPageInfo.Type

export const pageInfoNoMore: PullResPageInfo = { _tag: 'NoMore' } as const
export const pageInfoMoreUnknown: PullResPageInfo = { _tag: 'MoreUnknown' } as const
export const pageInfoMoreKnown = (remaining: number): PullResPageInfo => ({ _tag: 'MoreKnown', remaining })

export interface PullResItem<TSyncMetadata = Schema.JsonValue> {
  batch: ReadonlyArray<{
    eventEncoded: LiveStoreEvent.AnyEncodedGlobal
    metadata: Option.Option<TSyncMetadata>
  }>
  pageInfo: PullResPageInfo
}

export const of = <TSyncMetadata = Schema.JsonValue>(obj: SyncBackend<TSyncMetadata>) => obj

/**
 * Useful to continue pulling from the last event in the batch.
 */
export const cursorFromPullResItem = <TSyncMetadata = Schema.JsonValue>(
  item: PullResItem<TSyncMetadata>,
): Option.Option<{
  cursor: EventSequenceNumber.GlobalEventSequenceNumber
  metadata: Option.Option<TSyncMetadata>
}> => {
  const lastEvent = item.batch.at(-1)
  if (!lastEvent) {
    return Option.none()
  }
  return Option.some({ cursor: lastEvent.eventEncoded.seqNum, metadata: lastEvent.metadata })
}
