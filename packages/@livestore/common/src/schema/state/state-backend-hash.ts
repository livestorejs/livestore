import type { LiveStoreSchema } from '../schema.ts'

/**
 * SQLite-only helper (Milestone 1).
 * Keeps existing behavior: manual migrations => 'fixed', else use state backend hash.
 */
export const getStateSchemaHashSuffix = (schema: LiveStoreSchema): string => {
  const migrations = schema.state.backend.migrations
  return migrations.strategy === 'manual' ? 'fixed' : schema.state.backend.hash.toString()
}
