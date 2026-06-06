import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * STATE DATABASE SYSTEM TABLES
 *
 * ⚠️  SAFE TO CHANGE: State tables are automatically rebuilt from eventlog when schema changes.
 * No need to bump `liveStoreStorageFormatVersion` (uses hash-based migration via SqliteAst.hash()).
 */

export const SCHEMA_META_TABLE = '__livestore_schema'

/**
 * Tracks schema hashes for user-defined tables to detect schema changes.
 */
export const schemaMetaTable = table({
  name: SCHEMA_META_TABLE,
  columns: {
    tableName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.integer({ nullable: false }),
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
 *
 * This is separate from the materialization journal, so a state database snapshot
 * carries its own event sequence number. Journal rows are rollback records and
 * may be pruned after event confirmation, so they are not a reliable marker for
 * the event sequence number reflected by the current state database contents.
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

// TODO: Rename the physical table name to `__livestore_materialization_journal`
export const MATERIALIZATION_JOURNAL_META_TABLE = '__livestore_session_changeset'

/** @deprecated Use {@link MATERIALIZATION_JOURNAL_META_TABLE}. */
export const SESSION_CHANGESET_META_TABLE = MATERIALIZATION_JOURNAL_META_TABLE

/**
 * Materialization journal used to roll back state database changes during rebasing.
 */
export const materializationJournalMetaTable = table({
  name: MATERIALIZATION_JOURNAL_META_TABLE,
  columns: {
    // TODO bring back primary key
    seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.Global.Schema }),
    seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.Client.Schema }),
    seqNumRebaseGeneration: SqliteDsl.integer({}),
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
  },
  // TODO: Rename the index name to `idx_materialization_journal_id`
  indexes: [{ columns: ['seqNumGlobal', 'seqNumClient'], name: 'idx_session_changeset_id' }],
})

/** @deprecated Use {@link materializationJournalMetaTable}. */
export const sessionChangesetMetaTable = materializationJournalMetaTable

export type MaterializationJournalMetaRow = typeof materializationJournalMetaTable.Type

/** @deprecated Use {@link MaterializationJournalMetaRow}. */
export type SessionChangesetMetaRow = MaterializationJournalMetaRow

export const stateSystemTables = [
  schemaMetaTable,
  schemaEventDefsMetaTable,
  stateHeadMetaTable,
  materializationJournalMetaTable,
] as const

export const isStateSystemTable = (tableName: string) => stateSystemTables.some((_) => _.sqliteDef.name === tableName)
