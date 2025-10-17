import type { LiveStoreSchema } from '@livestore/common/schema'
import type { StoreOptions } from './types.ts'

export function storeOptions<TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): StoreOptions<TSchema> {
  return options
}
