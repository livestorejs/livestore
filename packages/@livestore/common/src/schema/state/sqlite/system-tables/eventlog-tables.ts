import { Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
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

export const PENDING_COMMANDS_TABLE = '__livestore_pending_commands'

/**
 * Tracks pending commands awaiting confirmation.
 *
 * Commands are:
 * 1. Enqueued when successfully executed locally (producing pending events)
 * 2. Replayed during reconciliation when new confirmed events arrive
 * 3. Dequeued when their events are successfully pushed to the sync backend
 */
export const pendingCommandsTable = table({
  name: PENDING_COMMANDS_TABLE,
  columns: {
    /** Unique identifier for the command instance (nanoid). */
    id: SqliteDsl.text({ primaryKey: true }),

    /** The command type name (e.g., 'CheckInGuest'). */
    name: SqliteDsl.text({ nullable: false }),

    /** Serialized command arguments (JSON). */
    args: SqliteDsl.json({ nullable: false }),

    /** ISO timestamp when the command was enqueued. */
    createdAt: SqliteDsl.text({ nullable: false }),

    /**
     * Array of event sequence numbers produced by this command.
     * Used to correlate events with their originating command.
     * Format: Array of { global: number, client: number, rebaseGeneration: number }
     */
    producedEventSeqNums: SqliteDsl.json({ nullable: true }),

    /**
     * Current status of the command.
     * - 'pending': Awaiting confirmation
     * - 'confirmed': Events pushed to sync backend
     * - 'failed': Failed during replay (conflict)
     */
    status: SqliteDsl.text({ nullable: false }),

    /** Error details if status is 'failed' (JSON). */
    error: SqliteDsl.json({ nullable: true }),
  },
  indexes: [
    { columns: ['status'], name: 'idx_pending_commands_status' },
    { columns: ['createdAt'], name: 'idx_pending_commands_created' },
  ],
})

export type PendingCommandRow = typeof pendingCommandsTable.Type

/** Status values for pending commands. */
export type PendingCommandStatus = 'pending' | 'confirmed' | 'failed'

export const eventlogSystemTables = [eventlogMetaTable, syncStatusTable, pendingCommandsTable] as const
