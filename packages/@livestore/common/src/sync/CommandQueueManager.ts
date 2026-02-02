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
import { PENDING_COMMANDS_TABLE, type PendingCommandRow } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'

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
 * Commands are stored when executed locally and removed when confirmed or failed.
 * If a command is in the table, it's pending.
 */
export interface CommandQueueManager {
  /**
   * Enqueue a command after successful local execution.
   */
  enqueue: (command: EnqueueCommandInput) => void

  /**
   * Get all pending commands in creation order.
   */
  getPending: () => ReadonlyArray<PendingCommandRow>

  /**
   * Remove confirmed commands from the queue.
   */
  confirm: (commandIds: ReadonlyArray<string>) => void

  /**
   * Remove a failed command from the queue.
   *
   * The conflict should be emitted separately before calling this.
   */
  fail: (commandId: string) => void

  /**
   * Clear all pending commands.
   */
  clear: () => void
}

/**
 * Create a CommandQueueManager backed by SQLite.
 *
 * @param db - The SQLite database instance (eventlog DB)
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
      sql`INSERT INTO ${PENDING_COMMANDS_TABLE} (id, name, args, createdAt, producedEventSeqNums)
          VALUES ($id, $name, $args, $createdAt, $producedEventSeqNums)`,
      {
        $id: command.id,
        $name: command.name,
        $args: JSON.stringify(command.args),
        $createdAt: new Date().toISOString(),
        $producedEventSeqNums: JSON.stringify(serializedSeqNums),
      } as any,
    )
  }

  const getPending: CommandQueueManager['getPending'] = () => {
    return db.select<PendingCommandRow>(
      sql`SELECT id, name, args, createdAt, producedEventSeqNums
          FROM ${PENDING_COMMANDS_TABLE}
          ORDER BY createdAt ASC`,
    )
  }

  const remove = (commandIds: ReadonlyArray<string>) => {
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

  const confirm: CommandQueueManager['confirm'] = (commandIds) => {
    remove(commandIds)
  }

  const fail: CommandQueueManager['fail'] = (commandId) => {
    remove([commandId])
  }

  const clear: CommandQueueManager['clear'] = () => {
    db.execute(sql`DELETE FROM ${PENDING_COMMANDS_TABLE}`)
  }

  return {
    enqueue,
    getPending,
    confirm,
    fail,
    clear,
  }
}
