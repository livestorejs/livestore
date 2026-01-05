import type { ServerAheadError, UnknownError } from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Context, type Effect, type Option, type Stream } from '@livestore/utils/effect'
import type { SyncMessage } from '../../common/mod.ts'

/**
 * Storage interface for sync backends.
 * Implementations can use memory, SQLite, or any other storage mechanism.
 */
export interface SyncStorage {
  /**
   * Get events from storage after the given cursor.
   * Returns a stream of events with their metadata.
   */
  readonly getEvents: (
    storeId: string,
    cursor: Option.Option<EventSequenceNumber.Global.Type>,
  ) => Effect.Effect<
    {
      readonly total: number
      readonly stream: Stream.Stream<
        {
          readonly eventEncoded: LiveStoreEvent.Global.Encoded
          readonly metadata: Option.Option<SyncMessage.SyncMetadata>
        },
        UnknownError
      >
    },
    UnknownError
  >

  /**
   * Append events atomically.
   * Fails with ServerAheadError if events are out of sequence.
   */
  readonly appendEvents: (
    storeId: string,
    batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
    createdAt: string,
  ) => Effect.Effect<void, UnknownError | ServerAheadError>

  /**
   * Get the current head sequence number for a store.
   */
  readonly getHead: (storeId: string) => Effect.Effect<Option.Option<EventSequenceNumber.Global.Type>, UnknownError>

  /**
   * Get or create a unique backend ID for a store.
   * The backend ID changes when the store is reset.
   */
  readonly getBackendId: (storeId: string) => Effect.Effect<string, UnknownError>

  /**
   * Reset all data for a store.
   */
  readonly resetStore: (storeId: string) => Effect.Effect<void, UnknownError>
}

/** Effect Context tag for SyncStorage service */
export class SyncStorageTag extends Context.Tag('SyncStorage')<SyncStorageTag, SyncStorage>() {}
