/**
 * Command Queue
 *
 * Effect-based service for managing pending commands awaiting confirmation from the sync backend.
 * Commands are persisted to SQLite (eventlog database) and survive app restarts.
 *
 * @module
 */

import { Context, Effect, Layer, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.ts'
import type * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import { PENDING_COMMANDS_TABLE, type PendingCommandRow } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import { sql } from '../util.ts'

// Re-export PendingCommandRow for consumers
export type { PendingCommandRow }

/**
 * Serialized event sequence number for storage.
 */
export interface SerializedSeqNum {
  global: number
  client: number
  rebaseGeneration: number
}

/**
 * Input for enqueuing a command.
 */
export interface EnqueueCommandInput {
  /** Unique command instance ID. */
  readonly id: string
  /** Command type name. */
  readonly name: string
  /** Command arguments (will be JSON serialized). */
  readonly args: unknown
  /** Sequence numbers of events produced by this command. */
  readonly producedEventSeqNums: ReadonlyArray<EventSequenceNumber.Client.Composite>
}

/**
 * Tagged error for CommandQueue operations.
 */
export class CommandQueueError extends Schema.TaggedError<CommandQueueError>()('CommandQueueError', {
  message: Schema.String,
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

/**
 * Service for managing pending commands awaiting confirmation.
 *
 * Commands are stored when executed locally and removed when confirmed or failed.
 * If a command is in the table, it's pending.
 */
export class CommandQueue extends Context.Tag('@livestore/common/CommandQueue')<
  CommandQueue,
  {
    /**
     * Enqueue a command after successful local execution.
     * Idempotent - if a command with the same ID exists, this is a no-op.
     */
    readonly enqueue: (command: EnqueueCommandInput) => Effect.Effect<void, CommandQueueError>

    /**
     * Get all pending commands in creation order.
     * Returns commands as stored (JSON strings for args/seqNums).
     */
    readonly getPending: () => Effect.Effect<ReadonlyArray<PendingCommandRow>, CommandQueueError>

    /**
     * Confirm commands by removing them from the queue.
     * Called when the sync backend has confirmed the events produced by these commands.
     */
    readonly confirm: (commandIds: ReadonlyArray<string>) => Effect.Effect<void, CommandQueueError>

    /**
     * Fail a command by removing it from the queue.
     * Called when a command fails during replay (conflict).
     * The conflict should be emitted separately before calling this.
     */
    readonly fail: (commandId: string) => Effect.Effect<void, CommandQueueError>

    /**
     * Clear all pending commands.
     * Used during hard reset or testing.
     */
    readonly clear: () => Effect.Effect<void, CommandQueueError>

    /**
     * Get the count of pending commands.
     * Useful for debugging and monitoring.
     */
    readonly size: () => Effect.Effect<number, CommandQueueError>
  }
>() {}

/**
 * Create a CommandQueue layer backed by SQLite.
 *
 * @param db - The SQLite database instance (eventlog DB)
 */
export const layer = (db: SqliteDb): Layer.Layer<CommandQueue> =>
  Layer.succeed(
    CommandQueue,
    CommandQueue.of({
      enqueue: (command) =>
        Effect.try({
          try: () => {
            const serializedSeqNums: SerializedSeqNum[] = command.producedEventSeqNums.map((seqNum) => ({
              global: seqNum.global,
              client: seqNum.client,
              rebaseGeneration: seqNum.rebaseGeneration,
            }))

            db.execute(
              sql`INSERT OR IGNORE INTO ${PENDING_COMMANDS_TABLE} (id, name, args, createdAt, producedEventSeqNums)
                  VALUES ($id, $name, $args, $createdAt, $producedEventSeqNums)`,
              {
                $id: command.id,
                $name: command.name,
                $args: JSON.stringify(command.args),
                $createdAt: new Date().toISOString(),
                $producedEventSeqNums: JSON.stringify(serializedSeqNums),
              } as any,
            )
          },
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to enqueue command',
              operation: 'enqueue',
              cause,
            }),
        }),

      getPending: () =>
        Effect.try({
          try: () =>
            db.select<PendingCommandRow>(
              sql`SELECT id, name, args, createdAt, producedEventSeqNums
                  FROM ${PENDING_COMMANDS_TABLE}
                  ORDER BY createdAt ASC`,
            ),
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to get pending commands',
              operation: 'getPending',
              cause,
            }),
        }),

      confirm: (commandIds) =>
        Effect.try({
          try: () => {
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
          },
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to confirm commands',
              operation: 'confirm',
              cause,
            }),
        }),

      fail: (commandId) =>
        Effect.try({
          try: () => {
            db.execute(sql`DELETE FROM ${PENDING_COMMANDS_TABLE} WHERE id = $id`, { $id: commandId } as any)
          },
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to fail command',
              operation: 'fail',
              cause,
            }),
        }),

      clear: () =>
        Effect.try({
          try: () => {
            db.execute(sql`DELETE FROM ${PENDING_COMMANDS_TABLE}`)
          },
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to clear command queue',
              operation: 'clear',
              cause,
            }),
        }),

      size: () =>
        Effect.try({
          try: () => {
            const result = db.select<{ count: number }>(sql`SELECT COUNT(*) as count FROM ${PENDING_COMMANDS_TABLE}`)
            return result[0]?.count ?? 0
          },
          catch: (cause) =>
            new CommandQueueError({
              message: 'Failed to get queue size',
              operation: 'size',
              cause,
            }),
        }),
    }),
  )
