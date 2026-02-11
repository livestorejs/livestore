/**
 * Command Execution Result Types
 *
 * This module defines the result types returned by `store.execute()`.
 *
 * @module
 */

/**
 * Result of confirmation after sync. Always resolves — never rejects.
 *
 * Used as the resolution type of {@link ExecuteResultPending.confirmation} so
 * consumers can pattern-match on success vs conflict without untyped
 * promise rejections.
 */
export type CommandConfirmation<TError = unknown> =
  | { readonly _tag: 'confirmed' }
  | { readonly _tag: 'conflict'; readonly error: TError }

/**
 * Result of a failed command execution.
 *
 * Returned when the command handler returns an error value or when the
 * runtime catches an unexpected throw during initial execution.
 */
export interface ExecuteResultFailed<TError = unknown> {
  /** Type discriminator for failed result. */
  readonly _tag: 'failed'

  /** The error that caused the command to fail. */
  readonly error: TError
}

/**
 * Result of a successful command execution.
 *
 * Returned when the command handler successfully produces events.
 * The events are materialized locally but may still fail during replay
 * during sync reconciliation.
 */
export interface ExecuteResultPending<TError = never> {
  /** Type discriminator for pending result. */
  readonly _tag: 'pending'

  /**
   * Promise that resolves when the command's events are confirmed by the sync backend.
   *
   * The promise always resolves to a {@link CommandConfirmation} — it never rejects.
   *
   * @example
   * ```ts
   * const result = store.execute(commands.checkInGuest({ roomId, guestId }))
   *
   * if (result._tag === 'pending') {
   *   const confirmation = await result.confirmation
   *   if (confirmation._tag === 'confirmed') {
   *     toast.success('Check-in confirmed')
   *   } else {
   *     toast.error(`Check-in rolled back: ${confirmation.error}`)
   *   }
   * }
   * ```
   */
  readonly confirmation: Promise<CommandConfirmation<TError>>
}

/**
 * Result of a command execution.
 *
 * Commands either fail immediately during validation (`failed`)
 * or succeed with pending confirmation (`pending`).
 *
 * @example Infallible command
 * ```ts
 * const result = store.execute(commands.checkInGuest({ roomId, guestId }))
 *
 * if (result._tag === 'failed') {
 *   // result.error is CommandExecutionError (unexpected throw)
 *   toast.error(result.error.message)
 *   return
 * }
 *
 * // Optimistic UI applied — events are materialized locally
 * const guest = store.query(tables.guests.get(guestId))
 * toast.success(guest.status === 'waitlisted' ? 'Waitlisted' : 'Checked in')
 *
 * // Optionally await server confirmation
 * const confirmation = await result.confirmation
 * if (confirmation._tag === 'conflict') {
 *   toast.error('Action rolled back')
 * }
 * ```
 *
 * @example Fallible command with typed error
 * ```ts
 * const result = store.execute(commands.createTodo({ id, text }))
 *
 * if (result._tag === 'failed') {
 *   // result.error is TodoTextEmpty | CommandExecutionError — fully typed
 *   console.error('Failed:', result.error)
 *   return
 * }
 * ```
 */
export type ExecuteResult<TError = unknown> = ExecuteResultFailed<TError> | ExecuteResultPending<TError>

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

    /** The command arguments. */
    readonly args: unknown
  }

  /** The error that caused the replay to fail. */
  readonly error: Error

  /** Timestamp when the conflict was detected. */
  readonly timestamp: number
}
