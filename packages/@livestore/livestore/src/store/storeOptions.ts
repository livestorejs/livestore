import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Schema } from '@livestore/utils/effect'
import type { RegistryStoreOptions } from './StoreRegistry.ts'

/**
 * Helper to define reusable store options with full type inference.
 *
 * At runtime this is an identity function that returns the input unchanged.
 * Its value lies in enabling TypeScript's excess property checking to catch
 * typos and configuration errors, while allowing options to be shared across
 * `useStore()`, `storeRegistry.preload()`, `storeRegistry.getOrLoad()`, etc.
 *
 * @typeParam TSchema - The LiveStore schema type
 * @typeParam TContext - User-defined context attached to the store
 * @typeParam TSyncPayloadSchema - Schema for the sync payload sent to the backend
 * @param options - The store configuration options
 * @returns The same options object, unchanged
 *
 * @example
 * ```ts
 * export const issueStoreOptions = (issueId: string) =>
 *   storeOptions({
 *     storeId: `issue-${issueId}`,
 *     schema,
 *     adapter,
 *     unusedCacheTime: 30_000,
 *   })
 *
 * // In a component
 * const issueStore = useStore(issueStoreOptions(issueId))
 *
 * // In a route loader or event handler
 * storeRegistry.preload({
 *   ...issueStoreOptions(issueId),
 *   unusedCacheTime: 10_000,
 * });
 * ```
 */
export function storeOptions<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
): RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema> {
  return options
}
