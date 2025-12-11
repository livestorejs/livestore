import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Schema } from '@livestore/utils/effect'
import type { CachedStoreOptions } from './types.ts'

export function storeOptions<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: CachedStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
): CachedStoreOptions<TSchema, TContext, TSyncPayloadSchema> {
  return options
}
