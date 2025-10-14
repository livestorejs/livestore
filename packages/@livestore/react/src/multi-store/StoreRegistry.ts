import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStorePromise as loadStore, type Store, type Unsubscribe } from '@livestore/livestore'
import type { StoreDescriptor, StoreId } from './types.ts'

class StoreEntry<TSchema extends LiveStoreSchema = LiveStoreSchema> {
  readonly storeDescriptor: StoreDescriptor<TSchema>

  store: Store<TSchema> | undefined = undefined
  error: unknown = undefined
  promise: Promise<Store<TSchema>> | undefined = undefined

  #subscribers = new Set<() => void>()
  version = 0

  constructor(storeDescriptor: StoreDescriptor<TSchema>) {
    this.storeDescriptor = storeDescriptor
  }

  get subscriberCount() {
    return this.#subscribers.size
  }

  subscribe = (listener: () => void): Unsubscribe => {
    this.#subscribers.add(listener)
    return () => {
      this.#subscribers.delete(listener)
    }
  }

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

  reset = (): void => {
    this.store = undefined
    this.error = undefined
    this.promise = undefined
    this.notify()
  }
}

class StoreCache {
  readonly #entries = new Map<StoreId, StoreEntry>()

  get = <TSchema extends LiveStoreSchema>(storeId: StoreId): StoreEntry<TSchema> | undefined => {
    return this.#entries.get(storeId) as StoreEntry<TSchema> | undefined
  }

  /** Get or create a store entry */
  getOrCreate = <TSchema extends LiveStoreSchema>(storeDescriptor: StoreDescriptor<TSchema>): StoreEntry<TSchema> => {
    let entry = this.#entries.get(storeDescriptor.storeId) as StoreEntry<TSchema> | undefined

    if (!entry) {
      entry = new StoreEntry<TSchema>(storeDescriptor)
      this.#entries.set(storeDescriptor.storeId, entry as unknown as StoreEntry)
    }

    return entry
  }

  remove = (storeId: StoreId): void => {
    const entry = this.#entries.get(storeId)
    if (!entry) return
    this.#entries.delete(storeId)
    // Notify any subscribers of the removal to force re-render;
    // components will resubscribe to a new entry and re-read.
    try {
      entry.notify()
    } catch {
      // Best-effort notify
    }
  }

  clear = (): void => {
    for (const storeId of Array.from(this.#entries.keys())) {
      this.remove(storeId)
    }
  }
}

const GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

export class StoreRegistry {
  private readonly cache = new StoreCache()
  private readonly gcTimeouts = new Map<StoreId, ReturnType<typeof setTimeout>>()

  ensureStoreEntry = <TSchema extends LiveStoreSchema>(storeDescriptor: StoreDescriptor<TSchema>) => {
    return this.cache.getOrCreate(storeDescriptor)
  }

  read = <TSchema extends LiveStoreSchema>(storeDescriptor: StoreDescriptor<TSchema>): Store<TSchema> => {
    const entry = this.ensureStoreEntry(storeDescriptor)

    if (entry.store) return entry.store

    if (entry.error !== undefined) throw entry.error

    if (!entry.promise) {
      entry.promise = loadStore(storeDescriptor)
        .then((store) => {
          entry.setStore(store)
          return store
        })
        .catch((error) => {
          entry.setError(error)
          throw error
        })
    }

    // Suspend while fetching
    throw entry.promise
  }

  preload = <TSchema extends LiveStoreSchema>(storeDescriptor: StoreDescriptor<TSchema>): Promise<Store<TSchema>> => {
    const entry = this.ensureStoreEntry(storeDescriptor)

    if (entry.store) return Promise.resolve(entry.store)

    if (entry.promise) return entry.promise

    entry.promise = loadStore(storeDescriptor)
      .then((store) => {
        entry.setStore(store)

        // If still unused after preload, start GC countdown.
        if (entry.subscriberCount === 0) this.#scheduleGC(storeDescriptor.storeId)

        return store
      })
      .catch((error) => {
        entry.setError(error)

        if (entry.subscriberCount === 0) this.#scheduleGC(storeDescriptor.storeId)

        return Promise.reject(error)
      })

    return entry.promise
  }

  removeStore = (storeId: StoreId): void => {
    this.#cancelGC(storeId)
    this.cache.remove(storeId)
  }

  subscribe = <TSchema extends LiveStoreSchema>(
    storeDescriptor: StoreDescriptor<TSchema>,
    listener: () => void,
  ): Unsubscribe => {
    const entry = this.ensureStoreEntry(storeDescriptor)
    // Active subscriber: cancel any scheduled GC
    this.#cancelGC(storeDescriptor.storeId)

    const unsubscribe = entry.subscribe(listener)

    return () => {
      unsubscribe()
      // If no more subscribers remain, schedule GC
      if (entry.subscriberCount === 0) {
        this.#scheduleGC(storeDescriptor.storeId)
      }
    }
  }

  getVersion = <TSchema extends LiveStoreSchema>(storeDescriptor: StoreDescriptor<TSchema>): number => {
    const entry = this.ensureStoreEntry(storeDescriptor)
    return entry.version
  }

  #scheduleGC = (id: StoreId): void => {
    this.#cancelGC(id)
    const timer = setTimeout(() => {
      this.gcTimeouts.delete(id)
      this.cache.remove(id)
    }, GC_TIME)
    this.gcTimeouts.set(id, timer)
  }

  #cancelGC = (id: StoreId): void => {
    const t = this.gcTimeouts.get(id)
    if (t) {
      clearTimeout(t)
      this.gcTimeouts.delete(id)
    }
  }
}
