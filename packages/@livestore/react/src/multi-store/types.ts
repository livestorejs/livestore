import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { CreateStoreOptions, OtelOptions } from '@livestore/livestore'

export type StoreId = string

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
  readonly storeId: StoreId
}

export type StoreOptions<TSchema extends LiveStoreSchema> = StoreDescriptor<TSchema> &
  Pick<
    CreateStoreOptions<TSchema>,
    'boot' | 'batchUpdates' | 'disableDevtools' | 'confirmUnsavedChanges' | 'syncPayload' | 'debug'
  > & {
    signal?: AbortSignal
    otelOptions?: Partial<OtelOptions>
  }
