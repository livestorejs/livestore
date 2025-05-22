import { Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../../EventSequenceNumber.js'
import { SqliteDsl } from './db-schema/mod.js'
import { table } from './table-def.js'

/// Read model DB

export const SCHEMA_META_TABLE = '__livestore_schema'

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

/**
 * Table which stores SQLite changeset blobs which is used for rolling back
 * read-model state during rebasing.
 */
export const SESSION_CHANGESET_META_TABLE = '__livestore_session_changeset'

export const sessionChangesetMetaTable = table({
  name: SESSION_CHANGESET_META_TABLE,
  columns: {
    // TODO bring back primary key
    seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.ClientEventSequenceNumber }),
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
  },
  indexes: [{ columns: ['seqNumGlobal', 'seqNumClient'], name: 'idx_session_changeset_id' }],
})

export type SessionChangesetMetaRow = typeof sessionChangesetMetaTable.Type

export const LEADER_MERGE_COUNTER_TABLE = '__livestore_leader_merge_counter'

// TODO get rid of this table in favour of client-only merge generation
export const leaderMergeCounterTable = table({
  name: LEADER_MERGE_COUNTER_TABLE,
  columns: {
    id: SqliteDsl.integer({ primaryKey: true, schema: Schema.Literal(0) }),
    mergeCounter: SqliteDsl.integer({ primaryKey: true }),
  },
})

export type LeaderMergeCounterRow = typeof leaderMergeCounterTable.Type

export const stateSystemTables = [
  schemaMetaTable,
  schemaEventDefsMetaTable,
  sessionChangesetMetaTable,
  leaderMergeCounterTable,
]

export const isStateSystemTable = (tableName: string) => stateSystemTables.some((_) => _.sqliteDef.name === tableName)

/// Eventlog DB

export const EVENTLOG_META_TABLE = 'eventlog'

export const eventlogMetaTable = table({
  name: EVENTLOG_META_TABLE,
  columns: {
    // TODO Adjust modeling so a global event never needs a client id component
    seqNumGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    seqNumClient: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.ClientEventSequenceNumber }),
    parentSeqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    parentSeqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.ClientEventSequenceNumber }),
    name: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Any) }),
    clientId: SqliteDsl.text({}),
    sessionId: SqliteDsl.text({}),
    schemaHash: SqliteDsl.integer({}),
    syncMetadataJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Option(Schema.JsonValue)) }),
  },
  indexes: [
    { columns: ['seqNumGlobal'], name: 'idx_eventlog_seqNumGlobal' },
    { columns: ['seqNumGlobal', 'seqNumClient'], name: 'idx_eventlog_seqNum' },
  ],
})

export type EventlogMetaRow = typeof eventlogMetaTable.Type

export const SYNC_STATUS_TABLE = '__livestore_sync_status'

export const syncStatusTable = table({
  name: SYNC_STATUS_TABLE,
  columns: {
    head: SqliteDsl.integer({ primaryKey: true }),
  },
})

export type SyncStatusRow = typeof syncStatusTable.Type

export const eventlogSystemTables = [eventlogMetaTable, syncStatusTable]
