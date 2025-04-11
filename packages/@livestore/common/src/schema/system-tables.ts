import { Schema } from '@livestore/utils/effect'

import { SqliteDsl } from './db-schema/mod.js'
import * as EventId from './EventId.js'
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
    idGlobal: SqliteDsl.integer({ schema: EventId.GlobalEventId }),
    idClient: SqliteDsl.integer({ schema: EventId.ClientEventId }),
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
  },
  indexes: [{ columns: ['idGlobal', 'idClient'], name: 'idx_session_changeset_id' }],
})

export type SessionChangesetMetaRow = typeof sessionChangesetMetaTable.Type

export const LEADER_MERGE_COUNTER_TABLE = '__livestore_leader_merge_counter'

export const leaderMergeCounterTable = table({
  name: LEADER_MERGE_COUNTER_TABLE,
  columns: {
    id: SqliteDsl.integer({ primaryKey: true, schema: Schema.Literal(0) }),
    mergeCounter: SqliteDsl.integer({ primaryKey: true }),
  },
})

export type LeaderMergeCounterRow = typeof leaderMergeCounterTable.Type

export const systemTables = [
  schemaMetaTable,
  schemaEventDefsMetaTable,
  sessionChangesetMetaTable,
  leaderMergeCounterTable,
]

/// Eventlog DB

export const SyncStatus = Schema.Literal('synced', 'pending', 'error', 'clientOnly')
export type SyncStatus = typeof SyncStatus.Type

export const EVENTLOG_META_TABLE = 'eventlog'

export const eventlogMetaTable = table({
  name: EVENTLOG_META_TABLE,
  columns: {
    // TODO Adjust modeling so a global event never needs a client id component
    idGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventId.GlobalEventId }),
    idClient: SqliteDsl.integer({ primaryKey: true, schema: EventId.ClientEventId }),
    parentIdGlobal: SqliteDsl.integer({ schema: EventId.GlobalEventId }),
    parentIdClient: SqliteDsl.integer({ schema: EventId.ClientEventId }),
    name: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Any) }),
    clientId: SqliteDsl.text({}),
    sessionId: SqliteDsl.text({}),
    schemaHash: SqliteDsl.integer({}),
    syncMetadataJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Option(Schema.JsonValue)) }),
  },
  indexes: [
    { columns: ['idGlobal'], name: 'idx_eventlog_idGlobal' },
    { columns: ['idGlobal', 'idClient'], name: 'idx_eventlog_id' },
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
