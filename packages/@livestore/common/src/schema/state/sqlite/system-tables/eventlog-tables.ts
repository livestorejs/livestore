import { Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * EVENTLOG DATABASE SYSTEM TABLES
 *
 * ⚠️CRITICAL: NEVER modify eventlog schemas without bumping `liveStoreStorageFormatVersion`!
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
    // TODO(#1016): Add a commandId column to correlate events with their originating command
    seqNumGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.Global.Schema }),
    seqNumClient: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.Client.Schema }),
    seqNumRebaseGeneration: SqliteDsl.integer({ primaryKey: true }),
    parentSeqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.Global.Schema }),
    parentSeqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.Client.Schema }),
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

export const COMMAND_JOURNAL_TABLE = '__livestore_command_journal'

/**
 * Append-only journal that records locally-executed commands for later replay.
 *
 * Commands are journaled after successful initial execution and removed when their resulting events are confirmed
 * or when the command fails during replay. If a row exists, the command is pending.
 */
export const commandJournalTable = table({
  name: COMMAND_JOURNAL_TABLE,
  columns: {
    /** Unique identifier for the command instance. */
    id: SqliteDsl.text({ primaryKey: true }),

    /** The command type’s name (e.g., 'CheckInGuest'). */
    name: SqliteDsl.text({ nullable: false }),

    /** Serialized command arguments. */
    args: SqliteDsl.json({ nullable: false }),
  },
})

export type CommandJournalRow = typeof commandJournalTable.Type

export const eventlogSystemTables = [eventlogMetaTable, syncStatusTable, commandJournalTable] as const
