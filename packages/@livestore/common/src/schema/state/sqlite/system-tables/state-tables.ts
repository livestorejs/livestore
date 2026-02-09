import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
import type { StateBackendId } from '../../../schema.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { setTableBackendId, table } from '../table-def.ts'

/**
 * STATE DATABASE SYSTEM TABLES
 *
 * ⚠️  SAFE TO CHANGE: State tables are automatically rebuilt from eventlog when schema changes.
 * No need to bump `liveStoreStorageFormatVersion` (uses hash-based migration via SqliteAst.hash()).
 */

export const SCHEMA_META_TABLE = '__livestore_schema'
export const SCHEMA_EVENT_DEFS_META_TABLE = '__livestore_schema_event_defs'
export const SESSION_CHANGESET_META_TABLE = '__livestore_session_changeset'

export const stateSystemTableNames = [
  SCHEMA_META_TABLE,
  SCHEMA_EVENT_DEFS_META_TABLE,
  SESSION_CHANGESET_META_TABLE,
] as const

/**
 * Tracks schema hashes for user-defined tables to detect schema changes.
 */
export const makeStateSystemTables = (backendId: StateBackendId) => {
  const schemaMetaTable = table({
    name: SCHEMA_META_TABLE,
    columns: {
      tableName: SqliteDsl.text({ primaryKey: true }),
      schemaHash: SqliteDsl.integer({ nullable: false }),
      /** ISO date format */
      updatedAt: SqliteDsl.text({ nullable: false }),
    },
  })

  /**
   * Tracks schema hashes for event definitions to detect event schema changes.
   */
  const schemaEventDefsMetaTable = table({
    name: SCHEMA_EVENT_DEFS_META_TABLE,
    columns: {
      eventName: SqliteDsl.text({ primaryKey: true }),
      schemaHash: SqliteDsl.integer({ nullable: false }),
      /** ISO date format */
      updatedAt: SqliteDsl.text({ nullable: false }),
    },
  })

  /**
   * Table which stores SQLite changeset blobs which is used for rolling back
   * read-model state during rebasing.
   */
  const sessionChangesetMetaTable = table({
    name: SESSION_CHANGESET_META_TABLE,
    columns: {
      // TODO bring back primary key
      seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.Global.Schema }),
      seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.Client.Schema }),
      seqNumRebaseGeneration: SqliteDsl.integer({}),
      changeset: SqliteDsl.blob({ nullable: true }),
      debug: SqliteDsl.json({ nullable: true }),
    },
    indexes: [{ columns: ['seqNumGlobal', 'seqNumClient'], name: 'idx_session_changeset_id' }],
  })

  setTableBackendId(schemaMetaTable, backendId)
  setTableBackendId(schemaEventDefsMetaTable, backendId)
  setTableBackendId(sessionChangesetMetaTable, backendId)

  const stateSystemTables = [schemaMetaTable, schemaEventDefsMetaTable, sessionChangesetMetaTable] as const

  return { schemaMetaTable, schemaEventDefsMetaTable, sessionChangesetMetaTable, stateSystemTables }
}

type StateSystemTables = ReturnType<typeof makeStateSystemTables>

export type SchemaMetaRow = StateSystemTables['schemaMetaTable']['Type']
export type SchemaEventDefsMetaRow = StateSystemTables['schemaEventDefsMetaTable']['Type']
export type SessionChangesetMetaRow = StateSystemTables['sessionChangesetMetaTable']['Type']

export const isStateSystemTable = (tableName: string) =>
  (stateSystemTableNames as readonly string[]).includes(tableName)
