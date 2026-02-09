import { shouldNeverHappen } from '@livestore/utils'

import type { LiveStoreSchema, StateBackendId } from '../../../schema.ts'
import type { TableDef } from '../table-def.ts'
import { getTableBackendId } from '../table-def.ts'
import { SCHEMA_EVENT_DEFS_META_TABLE, SCHEMA_META_TABLE, SESSION_CHANGESET_META_TABLE } from './state-tables.ts'

export * from './eventlog-tables.ts'
export * from './state-tables.ts'

export type StateSystemTablesForBackend = {
  schemaMetaTable: TableDef.Any
  schemaEventDefsMetaTable: TableDef.Any
  sessionChangesetMetaTable: TableDef.Any
}

export const forStateBackend = (schema: LiveStoreSchema, backendId: StateBackendId): StateSystemTablesForBackend => {
  const backend = schema.state.backends.get(backendId)
  if (backend === undefined) {
    return shouldNeverHappen(`Unknown backend "${backendId}" while resolving state system tables.`)
  }

  const get = (name: string) => {
    const tableDef = backend.tables.get(name)
    if (tableDef === undefined) {
      return shouldNeverHappen(`Missing system table "${name}" in backend "${backendId}".`)
    }

    const taggedBackendId = getTableBackendId(tableDef)
    if (taggedBackendId !== backendId) {
      return shouldNeverHappen(
        `System table "${name}" in backend "${backendId}" is incorrectly tagged as "${taggedBackendId}".`,
      )
    }

    return tableDef
  }

  return {
    schemaMetaTable: get(SCHEMA_META_TABLE),
    schemaEventDefsMetaTable: get(SCHEMA_EVENT_DEFS_META_TABLE),
    sessionChangesetMetaTable: get(SESSION_CHANGESET_META_TABLE),
  }
}
