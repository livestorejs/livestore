import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * PENDING COMMANDS TABLE
 *
 * Stores commands that have been executed locally but whose events have not yet
 * been confirmed by the sync backend. Used for command replay during reconciliation.
 *
 * ⚠️ SAFE TO CHANGE: State tables are automatically rebuilt from eventlog when schema changes.
 */

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
