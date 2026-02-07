import { shouldNeverHappen } from '@livestore/utils'
import type { LiveStoreSchema, StateBackendId } from '../schema.ts'

/**
 * SQLite-only helper (Milestone 1).
 * Keeps existing behavior: manual migrations => 'fixed', else use state backend hash.
 */
export const getStateSchemaHashSuffixForBackend = (schema: LiveStoreSchema, backendId: StateBackendId): string => {
  const backend = schema.state.backends.get(backendId)
  if (backend === undefined) {
    return shouldNeverHappen(`Missing backend "${backendId}" while computing state schema hash suffix.`)
  }
  const migrations = backend.migrations
  return migrations.strategy === 'manual' ? 'fixed' : backend.hash.toString()
}

export const getStateDbBaseName = ({ schema, backendId }: { schema: LiveStoreSchema; backendId: StateBackendId }) => {
  const suffix = getStateSchemaHashSuffixForBackend(schema, backendId)
  return backendId === schema.state.defaultBackendId ? `state${suffix}` : `state@${backendId}${suffix}`
}

export const getStateSchemaHashSuffix = (schema: LiveStoreSchema): string =>
  getStateSchemaHashSuffixForBackend(schema, schema.state.defaultBackendId)
