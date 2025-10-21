import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { CreateStoreOptions, OtelOptions } from '@livestore/livestore'

export type StoreId = string

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
  readonly adapter: Adapter

  /**
   * The ID of the store.
   */
  readonly storeId: StoreId
}

export type CachedStoreOptions<
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
> = StoreDescriptor<TSchema> &
  Pick<
    CreateStoreOptions<TSchema, TContext>,
    'boot' | 'batchUpdates' | 'disableDevtools' | 'confirmUnsavedChanges' | 'syncPayload' | 'debug'
  > & {
    signal?: AbortSignal
    otelOptions?: Partial<OtelOptions>
    /**
     * The time in milliseconds that this store should remain
     * in memory after becoming inactive. When this store becomes
     * inactive, it will be garbage collected after this duration.
     *
     * Stores transition to the inactive state as soon as they have no
     * subscriptions registered, so when all components which use that
     * store have unmounted.
     *
     * @remarks
     * - When different `gcTime` config are used for the same store, the longest one will be used.
     * - If set to `Infinity`, will disable garbage collection
     * - The maximum allowed time is about {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value | 24 days}
     *
     * @defaultValue `60_000` (60 seconds) or `Infinity` during SSR to avoid
     * disposing stores before server render completes.
     */
    gcTime?: number
  }
