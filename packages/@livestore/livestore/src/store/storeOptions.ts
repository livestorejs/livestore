import type { LiveStoreSchema } from '@livestore/common/schema'
import type { CachedStoreOptions } from './types.ts'

export function storeOptions<TSchema extends LiveStoreSchema>(
  options: CachedStoreOptions<TSchema>,
): CachedStoreOptions<TSchema> {
  return options
}
