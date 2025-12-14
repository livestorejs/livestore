import { UnknownError } from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Effect, Layer, Option, Ref, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import type { SyncStorage } from './interface.ts'
import { SyncStorageTag } from './interface.ts'

type StoreData = {
  events: Array<{ eventEncoded: LiveStoreEvent.Global.Encoded; metadata: SyncMessage.SyncMetadata }>
  backendId: string
}

/**
 * In-memory storage implementation for development and testing.
 * Data is lost when the server stops.
 */
export const makeMemoryStorage = Effect.gen(function* () {
  /** Map of storeId -> store data */
  const storesRef = yield* Ref.make<Map<string, StoreData>>(new Map())

  const getOrCreateStore = (storeId: string) =>
    Ref.modify(storesRef, (stores) => {
      const existing = stores.get(storeId)
      if (existing !== undefined) {
        return [existing, stores] as const
      }
      const newStore: StoreData = {
        events: [],
        backendId: crypto.randomUUID(),
      }
      const newStores = new Map(stores)
      newStores.set(storeId, newStore)
      return [newStore, newStores] as const
    })

  const getEvents: SyncStorage['getEvents'] = (storeId, cursor) =>
    Effect.gen(function* () {
      const store = yield* getOrCreateStore(storeId)

      const cursorNum = Option.isSome(cursor) ? cursor.value : -1
      const filteredEvents = store.events.filter((e) => e.eventEncoded.seqNum > cursorNum)
      const total = filteredEvents.length

      const stream = Stream.fromIterable(filteredEvents).pipe(
        Stream.map(({ eventEncoded, metadata }) => ({
          eventEncoded,
          metadata: Option.some(metadata),
        })),
      )

      return { total, stream }
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:memory-storage:getEvents', { attributes: { storeId } }),
    )

  const appendEvents: SyncStorage['appendEvents'] = (storeId, batch, createdAt) =>
    Effect.gen(function* () {
      if (batch.length === 0) return

      const stores = yield* Ref.get(storesRef)
      const existing = stores.get(storeId)
      const store = existing ?? { events: [], backendId: crypto.randomUUID() }

      // Note: Sequence validation is done in the push handler using parentSeqNum.
      // Storage just appends events - validation happens at the handler level.
      const metadata = SyncMessage.SyncMetadata.make({ createdAt })
      const newEvents = batch.map((eventEncoded) => ({ eventEncoded, metadata }))

      yield* Ref.update(storesRef, (s) => {
        const newStores = new Map(s)
        newStores.set(storeId, {
          ...store,
          events: [...store.events, ...newEvents],
        })
        return newStores
      })
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:memory-storage:appendEvents', { attributes: { storeId, batchLength: batch.length } }),
    )

  const getHead: SyncStorage['getHead'] = (storeId) =>
    Effect.gen(function* () {
      const store = yield* getOrCreateStore(storeId)
      if (store.events.length === 0) {
        return Option.none()
      }
      return Option.some(store.events[store.events.length - 1]!.eventEncoded.seqNum as EventSequenceNumber.Global.Type)
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:memory-storage:getHead', { attributes: { storeId } }),
    )

  const getBackendId: SyncStorage['getBackendId'] = (storeId) =>
    Effect.gen(function* () {
      const store = yield* getOrCreateStore(storeId)
      return store.backendId
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:memory-storage:getBackendId', { attributes: { storeId } }),
    )

  const resetStore: SyncStorage['resetStore'] = (storeId) =>
    Ref.update(storesRef, (stores) => {
      const newStores = new Map(stores)
      newStores.delete(storeId)
      return newStores
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:memory-storage:resetStore', { attributes: { storeId } }),
    )

  return {
    getEvents,
    appendEvents,
    getHead,
    getBackendId,
    resetStore,
  } satisfies SyncStorage
})

/** Layer providing in-memory storage */
export const MemoryStorageLayer = Layer.effect(SyncStorageTag, makeMemoryStorage)
