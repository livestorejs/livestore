import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Schema } from '@livestore/utils/effect'
import type { CreateStoreOptions } from './create-store.ts'
import type { OtelOptions } from './store-types.ts'

export type RegistryStoreOptions<
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
> = Pick<
  CreateStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
  | 'storeId'
  | 'schema'
  | 'adapter'
  | 'context'
  | 'boot'
  | 'batchUpdates'
  | 'disableDevtools'
  | 'onBootStatus'
  | 'shutdownDeferred'
  | 'confirmUnsavedChanges'
  | 'syncPayloadSchema'
  | 'syncPayload'
  | 'params'
  | 'debug'
> & {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
  /**
   * The time in milliseconds that this store should remain
   * in memory after becoming unused. When this store becomes
   * unused (no active retentions), it will be disposed after this duration.
   *
   * Stores transition to the unused state as soon as they have no
   * active retentions, so when all components which use that store
   * have unmounted.
   *
   * @remarks
   * - When different `unusedCacheTime` values are used for the same store, the longest one will be used.
   * - If set to `Infinity`, will disable automatic disposal
   * - The maximum allowed time is about {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value | 24 days}
   *
   * @defaultValue `60_000` (60 seconds) or `Infinity` during SSR to avoid
   * disposing stores before server render completes.
   */
  unusedCacheTime?: number
}
