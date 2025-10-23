import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStorePromise, type Store, type Unsubscribe } from '@livestore/livestore'
import type { CachedStoreOptions, StoreId } from './types.ts'

type StoreEntryState<TSchema extends LiveStoreSchema> =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<Store<TSchema>> }
  | { status: 'success'; store: Store<TSchema> }
  | { status: 'error'; error: unknown }

/**
 * Minimal cache entry that tracks store state and subscribers.
 *
 * @typeParam TSchema - The schema for this entry's store.
 * @internal
 */
class StoreEntry<TSchema extends LiveStoreSchema = LiveStoreSchema> {
  #state: StoreEntryState<TSchema> = { status: 'idle' }

  /**
   * Set of subscriber callbacks to notify on state changes.
   */
  #subscribers = new Set<() => void>()

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
   * Notifies all subscribers of state changes.
   *
   * @remarks
   * This should be called after any meaningful state change.
   */
  notify = (): void => {
    for (const sub of this.#subscribers) {
      try {
        sub()
      } catch {
        // Swallow to protect other listeners
      }
    }
  }

  /**
   * Transitions to the loading state.
   */
  #setPromise(promise: Promise<Store<TSchema>>): void {
    if (this.#state.status === 'success' || this.#state.status === 'loading') return
    this.#state = { status: 'loading', promise }
    this.notify() // TODO: Test if notifying on loading is needed
  }

  /**
   * Transitions to the success state.
   */
  #setStore = (store: Store<TSchema>): void => {
    this.#state = { status: 'success', store }
    this.notify()
  }

  /**
   * Transitions to the error state.
   */
  #setError = (error: unknown): void => {
    this.#state = { status: 'error', error }
    this.notify()
  }

  /**
   * Initiates loading of the store if not already in progress.
   *
   * @param options - Store creation options
   * @param onSettle - Callback invoked when the promise settles (success or failure) if no subscribers remain
   * @returns Promise that resolves to the loaded store or rejects with an error
   *
   * @remarks
   * This method handles the complete lifecycle of loading a store:
   * - Creates the store promise via createStorePromise
   * - Transitions through loading → success/error states
   * - Invokes onSettle callback for GC scheduling when needed
   */
  getOrLoad = (options: CachedStoreOptions<TSchema>): Store<TSchema> | Promise<Store<TSchema>> => {
    if (this.#state.status === 'success') return this.#state.store
    if (this.#state.status === 'loading') return this.#state.promise
    if (this.#state.status === 'error') throw this.#state.error

    const promise = createStorePromise(options)
      .then((store) => {
        this.#setStore(store)
        return store
      })
      .catch((error) => {
        this.#setError(error)
        throw error
      })

    this.#setPromise(promise)

    return promise
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

  ensure = <TSchema extends LiveStoreSchema>(storeId: StoreId): StoreEntry<TSchema> => {
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

const DEFAULT_GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

type DefaultStoreOptions = Partial<
  Pick<
    CachedStoreOptions<any>,
    'batchUpdates' | 'disableDevtools' | 'confirmUnsavedChanges' | 'syncPayload' | 'debug' | 'otelOptions'
  >
> & {
  /**
   * The time in milliseconds that inactive stores remain in memory.
   * When a store becomes inactive, it will be garbage collected
   * after this duration.
   *
   * Stores transition to the inactive state as soon as they have no
   * subscriptions registered, so when all components which use that
   * store have unmounted.
   *
   * @remarks
   * - If set to `infinity`, will disable garbage collection
   * - The maximum allowed time is about {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value | 24 days}
   *
   * @defaultValue `60_000` (60 seconds) or `Infinity` during SSR to avoid
   * disposing stores before server render completes.
   */
  gcTime?: number
}

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
    return this.#cache.ensure<TSchema>(storeId)
  }

  /**
   * Get or load a store, returning it directly if loaded or a promise if loading.
   *
   * @typeParam TSchema - The schema of the store to load
   * @returns The loaded store if available, or a Promise that resolves to the store if loading
   * @throws unknown loading error
   *
   * @remarks
   * - Designed to work with React.use() for Suspense integration.
   * - When the store is already loaded, returns the store instance directly (not wrapped in a Promise)
   * - When loading, returns a stable Promise reference that can be used with React.use()
   * - This prevents re-suspension on subsequent renders when the store is already loaded
   */
  getOrLoad = <TSchema extends LiveStoreSchema>(
    options: CachedStoreOptions<TSchema>,
  ): Store<TSchema> | Promise<Store<TSchema>> => {
    const optionsWithDefaults = this.#applyDefaultOptions(options)
    const entry = this.ensureStoreEntry<TSchema>(optionsWithDefaults.storeId)
    this.#cancelGC(optionsWithDefaults.storeId)

    const storeOrPromise = entry.getOrLoad(optionsWithDefaults)

    if (storeOrPromise instanceof Promise) {
      return storeOrPromise.finally(() => {
        // If no subscribers remain after load settles, schedule GC
        if (entry.subscriberCount === 0) this.#scheduleGC(optionsWithDefaults.storeId)
      })
    }

    return storeOrPromise
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
  preload = async <TSchema extends LiveStoreSchema>(options: CachedStoreOptions<TSchema>): Promise<void> => {
    try {
      await this.getOrLoad(options)
    } catch {
      // Do nothing; preload is best-effort
    }
  }

  subscribe = <TSchema extends LiveStoreSchema>(storeId: StoreId, listener: () => void): Unsubscribe => {
    const entry = this.ensureStoreEntry<TSchema>(storeId)
    // Active subscriber: cancel any scheduled GC
    this.#cancelGC(storeId)

    const unsubscribe = entry.subscribe(listener)

    return () => {
      unsubscribe()
      // If no more subscribers remain, schedule GC
      if (entry.subscriberCount === 0) this.#scheduleGC(storeId)
    }
  }

  #applyDefaultOptions = <TSchema extends LiveStoreSchema>(
    options: CachedStoreOptions<TSchema>,
  ): CachedStoreOptions<TSchema> => ({
    ...this.#defaultOptions,
    ...options,
  })

  #scheduleGC = (id: StoreId): void => {
    this.#cancelGC(id)
    const timer = setTimeout(() => {
      this.#gcTimeouts.delete(id)
      this.#cache.remove(id)
    }, DEFAULT_GC_TIME)
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
