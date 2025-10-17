import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStorePromise, type Store, type Unsubscribe } from '@livestore/livestore'
import { noop } from '@livestore/utils'
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

type DefaultStoreOptions = Partial<
  Pick<
    StoreOptions<any>,
    'batchUpdates' | 'disableDevtools' | 'confirmUnsavedChanges' | 'syncPayload' | 'debug' | 'otelOptions'
  >
>

type StoreRegistryConfig = {
  defaultOptions?: DefaultStoreOptions
}

/**
 * Store Registry coordinating cache, GC, and Suspense reads.
 *
 * @public
 */
export class StoreRegistry {
  readonly #cache = new StoreCache()
  readonly #gcTimeouts = new Map<StoreId, ReturnType<typeof setTimeout>>()
  readonly #defaultOptions: DefaultStoreOptions

  constructor({ defaultOptions = {} }: StoreRegistryConfig = {}) {
    this.#defaultOptions = defaultOptions
  }

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
   * Resolves a store instance for imperative code paths.
   *
   * @typeParam TSchema - Schema associated with the requested store.
   * @returns A promise that resolves with the ready store or rejects with the loading error.
   *
   * @remarks
   * - If the store is already cached, the returned promise resolves immediately with that instance.
   * - Concurrent callers share the same in-flight request to avoid duplicate store creation.
   */
  load = async <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): Promise<Store<TSchema>> => {
    const optionsWithDefaults = this.#applyDefaultOptions(options)
    const entry = this.ensureStoreEntry<TSchema>(optionsWithDefaults.storeId)

    // If already loaded, return it
    if (entry.store) return entry.store

    // If a load is already in flight, return its promise
    if (entry.promise) return entry.promise

    // If a previous error exists, throw it
    if (entry.error !== undefined) throw entry.error

    // Load store if none is in flight
    entry.promise = createStorePromise(optionsWithDefaults)
      .then((store) => {
        entry.setStore(store)

        // If no one subscribed (e.g., initial render aborted), schedule GC.
        if (entry.subscriberCount === 0) this.#scheduleGC(optionsWithDefaults.storeId)

        return store
      })
      .catch((error) => {
        entry.setError(error)

        // Likewise, ensure unused entries are eventually collected.
        if (entry.subscriberCount === 0) this.#scheduleGC(optionsWithDefaults.storeId)

        throw error
      })

    return entry.promise
  }

  /**
   * Reads a store, throwing to integrate with Suspense/Error Boundaries.
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
  read = async <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): Promise<Store<TSchema>> => {
    const optionsWithDefaults = this.#applyDefaultOptions(options)
    const entry = this.ensureStoreEntry<TSchema>(optionsWithDefaults.storeId)

    // If already loaded, return it
    if (entry.store) return entry.store

    // If a previous error exists, throw it
    if (entry.error !== undefined) throw entry.error

    // If a load is already in flight, throw its promise to suspend
    if (entry.promise) throw entry.promise

    // Load store if none is in flight
    entry.promise = createStorePromise(optionsWithDefaults)
      .then((store) => {
        entry.setStore(store)

        // If no one subscribed (e.g., initial render aborted), schedule GC.
        if (entry.subscriberCount === 0) this.#scheduleGC(optionsWithDefaults.storeId)

        return store
      })
      .catch((error) => {
        entry.setError(error)

        // Likewise, ensure unused entries are eventually collected.
        if (entry.subscriberCount === 0) this.#scheduleGC(optionsWithDefaults.storeId)

        throw error
      })

    // Suspend while the load is in flight.
    throw entry.promise
  }

  /**
   * Warms the cache for a store without mounting a subscriber.
   *
   * @typeParam TSchema - The schema of the store to preload
   * @returns A promise that resolves when the loading is complete (success or failure)
   *
   * @remarks
   * - We don't return the store or throw as this is a fire-and-forget operation.
   * - If the entry remains unused after preload resolves/rejects, it is scheduled for GC.
   */
  preload = async <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): Promise<void> => {
    return this.load(options).then(noop).catch(noop)
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

  #applyDefaultOptions = <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): StoreOptions<TSchema> => ({
    ...this.#defaultOptions,
    ...options,
  })

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
