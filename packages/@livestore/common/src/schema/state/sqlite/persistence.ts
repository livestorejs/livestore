import type { LiveStoreSchema } from '../../schema.ts'

/**
 * Returns the schema-keyed base name shared by persisted state databases.
 *
 * @remarks
 *
 * Adapters append backend-specific storage-format namespaces and file
 * extensions.
 */
export const getStateDbBaseName = (schema: LiveStoreSchema): string => `state${schema.state.sqlite.hash}`
