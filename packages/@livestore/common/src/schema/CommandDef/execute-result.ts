/**
 * Command Execution Result Types
 *
 * This module defines the result types returned by `store.execute()`.
 *
 * @module
 */

/**
 * Result of a failed command execution.
 *
 * Returned when the command handler throws an error during initial execution.
 * The error contains details about why the command failed.
 */
export interface ExecuteResultFailed {
  /** Type discriminator for failed result. */
  readonly _tag: 'failed'

  /** The error that caused the command to fail. */
  readonly error: Error
}

/**
 * Result of a successful command execution.
 *
 * Returned when the command handler successfully produces events.
 * The events are materialized locally (optimistic UI) but may still
 * fail during replay after sync reconciliation.
 */
export interface ExecuteResultPending {
  /** Type discriminator for pending result. */
  readonly _tag: 'pending'

  /** Unique identifier of the executed command. */
  readonly commandId: string

  /**
   * Promise that resolves when the command's events are confirmed by the sync backend.
   *
   * The promise will:
   * - Resolve when events are successfully pushed to the sync backend
   * - Reject if the command fails during replay (conflict)
   *
   * @example
   * ```ts
   * const result = store.execute(commands.checkInGuest({ roomId, guestId }))
   *
   * if (result._tag === 'pending') {
   *   result.confirmed
   *     .then(() => toast.success('Check-in confirmed'))
   *     .catch((error) => toast.error(`Check-in cancelled: ${error.message}`))
   * }
   * ```
   */
  readonly confirmed: Promise<void>
}

/**
 * Result of a command execution.
 *
 * Commands either fail immediately during validation (`failed`)
 * or succeed with pending confirmation (`pending`).
 *
 * @example
 * ```ts
 * const result = store.execute(commands.checkInGuest({ roomId, guestId }))
 *
 * if (result._tag === 'failed') {
 *   // Command failed validation
 *   toast.error(result.error.message)
 *   return
 * }
 *
 * // Command succeeded locally - events are materialized (optimistic UI)
 * const guest = store.query(tables.guests.get(guestId))
 * toast.success(guest.status === 'waitlisted' ? 'Waitlisted' : 'Checked in')
 *
 * // Optionally await server confirmation
 * await result.confirmed
 * ```
 */
export type ExecuteResult = ExecuteResultFailed | ExecuteResultPending

/**
 * Conflict that occurred during command replay.
 *
 * When a command fails during replay (due to changed state after sync),
 * a conflict is emitted. The original events are rolled back and the
 * command's effects are undone.
 *
 * @example
 * ```ts
 * // Handle all conflicts
 * for await (const conflict of store.conflicts()) {
 *   toast.error(`Action failed: ${conflict.command.name}`)
 * }
 *
 * // Filter by command name
 * for await (const conflict of store.conflicts({ commands: ['CheckInGuest'] })) {
 *   handleCriticalConflict(conflict)
 * }
 * ```
 */
export interface CommandConflict {
  /** Details about the command that failed. */
  readonly command: {
    /** Unique identifier of the command instance. */
    readonly id: string

    /** The command type name. */
    readonly name: string

    /** The command arguments (payload). */
    readonly payload: unknown
  }

  /** The error that caused the replay to fail. */
  readonly error: Error

  /** Timestamp when the conflict was detected. */
  readonly timestamp: number
}
