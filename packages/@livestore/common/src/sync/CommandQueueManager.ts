/**
 * Command Queue Manager
 *
 * Manages the persistence and lifecycle of pending commands awaiting confirmation.
 * Commands are stored in SQLite and survive app restarts.
 *
 * @module
 */

import type { SqliteDb } from '../adapter-types.ts'
import type * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import {
  PENDING_COMMANDS_TABLE,
  type PendingCommandRow,
  type PendingCommandStatus,
} from '../schema/state/sqlite/system-tables/eventlog-tables.ts'

// Re-export PendingCommandRow for use in LeaderSyncProcessor
export type { PendingCommandRow }

import { sql } from '../util.ts'

/**
 * Serialized event sequence number for storage.
 */
export interface SerializedSeqNum {
  global: number
  client: number
  rebaseGeneration: number
}

/**
 * Command data for enqueuing.
 */
export interface EnqueueCommandInput {
  /** Unique command instance ID. */
  id: string
  /** Command type name. */
  name: string
  /** Command arguments. */
  args: unknown
  /** Sequence numbers of events produced by this command. */
  producedEventSeqNums: ReadonlyArray<EventSequenceNumber.Client.Composite>
}

/**
 * Manager for pending commands awaiting confirmation.
 *
 * Provides persistence and retrieval of commands that have been
 * executed locally but not yet confirmed by the sync backend.
 */
export interface CommandQueueManager {
  /**
   * Enqueue a command after successful local execution.
   *
   * Called when a command handler produces events and they are committed locally.
   */
  enqueue: (command: EnqueueCommandInput) => void

  /**
   * Get all pending commands in creation order.
   *
   * Returns commands with status 'pending', ordered by createdAt ascending.
   */
  getPending: () => ReadonlyArray<PendingCommandRow>

  /**
   * Mark commands as confirmed.
   *
   * Called when the command's events are successfully pushed to the sync backend.
   */
  confirm: (commandIds: ReadonlyArray<string>) => void

  /**
   * Mark a command as failed during replay.
   *
   * Called when a command fails during replay after sync reconciliation.
   */
  fail: (commandId: string, error: Error) => void

  /**
   * Remove commands from the queue.
   *
   * Called to clean up confirmed or failed commands.
   */
  dequeue: (commandIds: ReadonlyArray<string>) => void

  /**
   * Clear all pending commands.
   *
   * Called during hard reset or when clearing local state.
   */
  clear: () => void
}

/**
 * Create a CommandQueueManager backed by SQLite.
 *
 * @param db - The SQLite database instance (state DB)
 * @returns CommandQueueManager interface
 */
export const makeCommandQueueManager = (db: SqliteDb): CommandQueueManager => {
  const enqueue: CommandQueueManager['enqueue'] = (command) => {
    const serializedSeqNums: SerializedSeqNum[] = command.producedEventSeqNums.map((seqNum) => ({
      global: seqNum.global,
      client: seqNum.client,
      rebaseGeneration: seqNum.rebaseGeneration,
    }))

    db.execute(
      sql`INSERT INTO ${PENDING_COMMANDS_TABLE} (id, name, args, createdAt, producedEventSeqNums, status, error)
          VALUES ($id, $name, $args, $createdAt, $producedEventSeqNums, $status, NULL)`,
      {
        $id: command.id,
        $name: command.name,
        $args: JSON.stringify(command.args),
        $createdAt: new Date().toISOString(),
        $producedEventSeqNums: JSON.stringify(serializedSeqNums),
        $status: 'pending' satisfies PendingCommandStatus,
      } as any,
    )
  }

  const getPending: CommandQueueManager['getPending'] = () => {
    return db.select<PendingCommandRow>(
      sql`SELECT id, name, args, createdAt, producedEventSeqNums, status, error
          FROM ${PENDING_COMMANDS_TABLE}
          WHERE status = 'pending'
          ORDER BY createdAt ASC`,
    )
  }

  const confirm: CommandQueueManager['confirm'] = (commandIds) => {
    if (commandIds.length === 0) return

    const placeholders = commandIds.map((_, i) => `$id${i}`).join(', ')
    const bindValues = commandIds.reduce(
      (acc, id, i) => {
        acc[`$id${i}`] = id
        return acc
      },
      {} as Record<string, string>,
    )

    db.execute(
      sql`UPDATE ${PENDING_COMMANDS_TABLE} SET status = 'confirmed' WHERE id IN (${placeholders})`,
      bindValues as any,
    )
  }

  const fail: CommandQueueManager['fail'] = (commandId, error) => {
    const errorJson = JSON.stringify({
      message: error.message,
      name: error.name,
      stack: error.stack,
    })

    db.execute(sql`UPDATE ${PENDING_COMMANDS_TABLE} SET status = 'failed', error = $error WHERE id = $id`, {
      $id: commandId,
      $error: errorJson,
    } as any)
  }

  const dequeue: CommandQueueManager['dequeue'] = (commandIds) => {
    if (commandIds.length === 0) return

    const placeholders = commandIds.map((_, i) => `$id${i}`).join(', ')
    const bindValues = commandIds.reduce(
      (acc, id, i) => {
        acc[`$id${i}`] = id
        return acc
      },
      {} as Record<string, string>,
    )

    db.execute(sql`DELETE FROM ${PENDING_COMMANDS_TABLE} WHERE id IN (${placeholders})`, bindValues as any)
  }

  const clear: CommandQueueManager['clear'] = () => {
    db.execute(sql`DELETE FROM ${PENDING_COMMANDS_TABLE}`)
  }

  return {
    enqueue,
    getPending,
    confirm,
    fail,
    dequeue,
    clear,
  }
}
