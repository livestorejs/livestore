import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStorePromise, type Store, type Unsubscribe } from '@livestore/livestore'
import type { StoreId, StoreOptions } from './types.ts'

/**
 * Minimal cache entry that tracks store, error, and in-flight promise along with subscribers.
 *
 * @typeParam TSchema - The schema for this entry's store.
 * @internal
 */
class StoreEntry<TSchema extends LiveStoreSchema = LiveStoreSchema> {
  /**
   * The resolved store.
   *
   * @remarks
   * A value of `undefined` indicates "not loaded yet".
   */
  store: Store<TSchema> | undefined = undefined

  /**
   * The most recent error encountered for this entry, if any.
   */
  error: unknown = undefined

  /**
   * The in-flight promise for loading the store, or `undefined` if not yet loading or already resolved.
   */
  promise: Promise<Store<TSchema>> | undefined = undefined

  /**
   * Set of subscriber callbacks to notify on state changes.
   */
  #subscribers = new Set<() => void>()

  /**
   * Monotonic counter that increments on every notify.
   */
  version = 0

  /**
   * The number of active subscribers for this entry.
   */
  get subscriberCount() {
    return this.#subscribers.size
  }

  /**
   * Subscribes to this entry's updates.
   *
   * @param listener - Callback invoked when the entry changes
   * @returns Unsubscribe function
   */
  subscribe = (listener: () => void): Unsubscribe => {
    this.#subscribers.add(listener)
    return () => {
      this.#subscribers.delete(listener)
    }
  }

  /**
   * Notifies all subscribers and increments the version counter.
   *
   * @remarks
   * This should be called after any meaningful state change.
   */
  notify = (): void => {
    this.version++
    for (const sub of this.#subscribers) {
      try {
        sub()
      } catch {
        // Swallow to protect other listeners
      }
    }
  }

  setStore = (store: Store<TSchema>): void => {
    this.store = store
    this.error = undefined
    this.promise = undefined
    this.notify()
  }

  setError = (error: unknown): void => {
    this.error = error
    this.promise = undefined
    this.notify()
  }
}

/**
 * In-memory map of {@link StoreEntry} instances keyed by {@link StoreId}.
 *
 * @privateRemarks
 * The cache is intentionally small; eviction and GC timers are coordinated by the client.
 *
 * @internal
 */
class StoreCache {
  readonly #entries = new Map<StoreId, StoreEntry>()

  get = <TSchema extends LiveStoreSchema>(storeId: StoreId): StoreEntry<TSchema> | undefined => {
    return this.#entries.get(storeId) as StoreEntry<TSchema> | undefined
  }

  getOrCreate = <TSchema extends LiveStoreSchema>(storeId: StoreId): StoreEntry<TSchema> => {
    let entry = this.#entries.get(storeId) as StoreEntry<TSchema> | undefined

    if (!entry) {
      entry = new StoreEntry<TSchema>()
      this.#entries.set(storeId, entry as unknown as StoreEntry)
    }

    return entry
  }

  /**
   * Removes an entry from the cache and notifies its subscribers.
   *
   * @param storeId - The ID of the store to remove
   * @remarks
   * Notifying subscribers prompts consumers to re-render and re-read as needed.
   */
  remove = (storeId: StoreId): void => {
    const entry = this.#entries.get(storeId)
    if (!entry) return
    this.#entries.delete(storeId)
    // Notify any subscribers of the removal to force re-render;
    // components will resubscribe to a new entry and re-read.
    try {
      entry.notify()
    } catch {
      // Best-effort notify; swallowing to avoid crashing removal flows.
    }
  }

  clear = (): void => {
    for (const storeId of Array.from(this.#entries.keys())) {
      this.remove(storeId)
    }
  }
}

const GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

/**
 * Store Registry coordinating cache, GC, and Suspense reads.
 *
 * @public
 */
export class StoreRegistry {
  readonly #cache = new StoreCache()
  readonly #gcTimeouts = new Map<StoreId, ReturnType<typeof setTimeout>>()

  /**
   * Ensures a store entry exists in the cache.
   *
   * @param storeId - The ID of the store
   * @returns The existing or newly created store entry
   *
   * @internal
   */
  ensureStoreEntry = <TSchema extends LiveStoreSchema>(storeId: StoreId): StoreEntry<TSchema> => {
    return this.#cache.getOrCreate<TSchema>(storeId)
  }

  /**
   * Loads a store, throwing to integrate with Suspense/Error Boundaries.
   *
   * @typeParam TSchema - The schema of the store to load
   * @returns The loaded store
   * @throws Promise<TStore<TSchema>> that resolves when loading is complete to integrate with React Suspense
   * @throws unknown loading error to integrate with React Error Boundaries
   *
   * @remarks
   * - This API intentionally has no loading or error states; it cooperates with React Suspense and Error Boundaries.
   * - If the initial render that triggered the fetch never commits, we still schedule GC on settle.
   */
  load = <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): Store<TSchema> => {
    const entry = this.ensureStoreEntry<TSchema>(options.storeId)

    // If already loaded, return it
    if (entry.store) return entry.store

    // If a previous error exists, throw it
    if (entry.error !== undefined) throw entry.error

    // Load store if none is in flight
    if (!entry.promise) {
      entry.promise = createStorePromise(options)
        .then((store) => {
          entry.setStore(store)

          // If no one subscribed (e.g., initial render aborted), schedule GC.
          if (entry.subscriberCount === 0) this.#scheduleGC(options.storeId)

          return store
        })
        .catch((error) => {
          entry.setError(error)

          // Likewise, ensure unused entries are eventually collected.
          if (entry.subscriberCount === 0) this.#scheduleGC(options.storeId)

          throw error
        })
    }

    // Suspend while the load is in flight.
    throw entry.promise
  }

  /**
   * Warms the cache for a store without mounting a subscriber.
   *
   * @typeParam TSchema - The schema of the store to preload
   * @returns A promise that resolves when the store is loaded
   *
   * @remarks
   * - We don't return the store or throw as this is a fire-and-forget operation.
   * - If the entry remains unused after preload resolves/rejects, it is scheduled for GC.
   */
  preload = async <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): Promise<void> => {
    const entry = this.ensureStoreEntry<TSchema>(options.storeId)

    if (entry.store) return Promise.resolve()

    if (entry.promise) await entry.promise

    entry.promise = createStorePromise(options)
      .then((store) => {
        entry.setStore(store)

        // If still unused after preload, start GC countdown.
        if (entry.subscriberCount === 0) this.#scheduleGC(options.storeId)

        return store
      })
      .catch((error) => {
        entry.setError(error)

        if (entry.subscriberCount === 0) this.#scheduleGC(options.storeId)

        return Promise.reject(error)
      })

    await entry.promise
  }

  subscribe = <TSchema extends LiveStoreSchema>(storeId: StoreId, listener: () => void): Unsubscribe => {
    const entry = this.ensureStoreEntry<TSchema>(storeId)
    // Active subscriber: cancel any scheduled GC
    this.#cancelGC(storeId)

    const unsubscribe = entry.subscribe(listener)

    return () => {
      unsubscribe()
      // If no more subscribers remain, schedule GC
      if (entry.subscriberCount === 0) {
        this.#scheduleGC(storeId)
      }
    }
  }

  getVersion = <TSchema extends LiveStoreSchema>(storeId: StoreId): number => {
    const entry = this.ensureStoreEntry<TSchema>(storeId)
    return entry.version
  }

  #scheduleGC = (id: StoreId): void => {
    this.#cancelGC(id)
    const timer = setTimeout(() => {
      this.#gcTimeouts.delete(id)
      this.#cache.remove(id)
    }, GC_TIME)
    this.#gcTimeouts.set(id, timer)
  }

  #cancelGC = (id: StoreId): void => {
    const t = this.#gcTimeouts.get(id)
    if (t) {
      clearTimeout(t)
      this.#gcTimeouts.delete(id)
    }
  }
}
