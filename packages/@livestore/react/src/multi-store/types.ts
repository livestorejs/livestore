import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'

/**
 * Helper to future‑proof adapter/schema coupling.
 * Replace `AdapterFor<TSchema>` with `Adapter<TSchema>` when `Adapter` accepts a generic schema parameter.
 */
type AdapterFor<TSchema extends LiveStoreSchema> = Adapter

/**
 * Minimum information required to create a store
 */
export type StoreDescriptor<TSchema extends LiveStoreSchema> = {
  /**
   * Schema describing the data structure.
   */
  readonly schema: TSchema

  /**
   * Adapter for persistence and synchronization.
   */
  readonly adapter: AdapterFor<TSchema>

  /**
   * The ID of the store.
   */
  readonly storeId: string
}

export type StoreId = string
