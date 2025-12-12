import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Schema } from '@livestore/utils/effect'
import type { RegistryStoreOptions } from './StoreRegistry.ts'

export function storeOptions<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
): RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema> {
  return options
}
