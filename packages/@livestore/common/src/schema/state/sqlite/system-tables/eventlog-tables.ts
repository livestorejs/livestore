import { Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../../../EventSequenceNumber.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * EVENTLOG DATABASE SYSTEM TABLES
 *
 * ⚠️  CRITICAL: NEVER modify eventlog schemas without bumping `liveStoreStorageFormatVersion`!
 * Eventlog is the source of truth - schema changes cause permanent data loss.
 *
 * TODO: Implement proper eventlog versioning system to prevent accidental data loss
 */

export const EVENTLOG_META_TABLE = 'eventlog'

/**
 * Main client-side event log storing all events (global and local/rebased).
 */
export const eventlogMetaTable = table({
  name: EVENTLOG_META_TABLE,
  columns: {
    // TODO Adjust modeling so a global event never needs a client id component
    seqNumGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    seqNumClient: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.ClientEventSequenceNumber }),
    seqNumRebaseGeneration: SqliteDsl.integer({ primaryKey: true }),
    parentSeqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    parentSeqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.ClientEventSequenceNumber }),
    parentSeqNumRebaseGeneration: SqliteDsl.integer({}),
    /** Event definition name */
    name: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Any) }),
    clientId: SqliteDsl.text({}),
    sessionId: SqliteDsl.text({}),
    schemaHash: SqliteDsl.integer({}),
    syncMetadataJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Option(Schema.JsonValue)) }),
  },
  indexes: [
    { columns: ['seqNumGlobal'], name: 'idx_eventlog_seqNumGlobal' },
    { columns: ['seqNumGlobal', 'seqNumClient', 'seqNumRebaseGeneration'], name: 'idx_eventlog_seqNum' },
  ],
})

export type EventlogMetaRow = typeof eventlogMetaTable.Type

export const SYNC_STATUS_TABLE = '__livestore_sync_status'

/**
 * Tracks sync status including the remote head position and backend identity.
 */
// TODO support sync backend identity (to detect if sync backend changes)
export const syncStatusTable = table({
  name: SYNC_STATUS_TABLE,
  columns: {
    head: SqliteDsl.integer({ primaryKey: true }),
    // Null means the sync backend is not yet connected and we haven't yet seen a backend ID
    backendId: SqliteDsl.text({ nullable: true }),
  },
})

export type SyncStatusRow = typeof syncStatusTable.Type

export const eventlogSystemTables = [eventlogMetaTable, syncStatusTable] as const
