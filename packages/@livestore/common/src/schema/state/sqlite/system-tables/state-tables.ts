import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * STATE DATABASE SYSTEM TABLES
 *
 * ⚠️  SAFE TO CHANGE: State tables are automatically rebuilt from eventlog when schema changes.
 * No need to bump `liveStoreStorageFormatVersion` because state tables use fingerprint-based migration.
 */

export const SCHEMA_META_TABLE = '__livestore_schema'

/**
 * Tracks schema hashes for user-defined tables to detect schema changes.
 */
export const schemaMetaTable = table({
  name: SCHEMA_META_TABLE,
  columns: {
    tableName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.text({ nullable: false }),
    /** ISO date format */
    updatedAt: SqliteDsl.text({ nullable: false }),
  },
})

export type SchemaMetaRow = typeof schemaMetaTable.Type

export const SCHEMA_EVENT_DEFS_META_TABLE = '__livestore_schema_event_defs'

/**
 * Tracks schema hashes for event definitions to detect event schema changes.
 */
export const schemaEventDefsMetaTable = table({
  name: SCHEMA_EVENT_DEFS_META_TABLE,
  columns: {
    eventName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.integer({ nullable: false }),
    /** ISO date format */
    updatedAt: SqliteDsl.text({ nullable: false }),
  },
})

export type SchemaEventDefsMetaRow = typeof schemaEventDefsMetaTable.Type

export const STATE_HEAD_META_TABLE = '__livestore_state_head'

/**
 * Single-row marker for the latest event sequence number reflected by the state DB.
 *
 * @remarks
 * This is separate from the session changeset table because confirmed changesets
 * can be removed after they are no longer needed for rollback.
 */
export const stateHeadMetaTable = table({
  name: STATE_HEAD_META_TABLE,
  columns: {
    id: SqliteDsl.integer({ primaryKey: true }),
    seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.Global.Schema }),
    seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.Client.Schema }),
    seqNumRebaseGeneration: SqliteDsl.integer({}),
  },
})

export type StateHeadMetaRow = typeof stateHeadMetaTable.Type

/**
 * Table which stores SQLite changeset blobs which is used for rolling back
 * read-model state during rebasing.
 */
export const SESSION_CHANGESET_META_TABLE = '__livestore_session_changeset'

export const sessionChangesetMetaTable = table({
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

export type SessionChangesetMetaRow = typeof sessionChangesetMetaTable.Type

// TODO: Rename the physical table once legacy session changeset consumers have been migrated.
export const MATERIALIZATION_JOURNAL_META_TABLE = SESSION_CHANGESET_META_TABLE

/**
 * Materialization journal used to roll back state database changes during rebasing.
 *
 * @remarks
 * This aliases the legacy table definition until all session changeset consumers
 * have adopted the journal service.
 */
export const materializationJournalMetaTable = sessionChangesetMetaTable

export type MaterializationJournalMetaRow = SessionChangesetMetaRow

export const stateSystemTables = [
  schemaMetaTable,
  schemaEventDefsMetaTable,
  stateHeadMetaTable,
  sessionChangesetMetaTable,
] as const

export const isStateSystemTable = (tableName: string) => stateSystemTables.some((_) => _.sqliteDef.name === tableName)
