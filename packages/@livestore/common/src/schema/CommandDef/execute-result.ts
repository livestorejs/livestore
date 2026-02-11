/**
 * Command Execution Result Types
 *
 * This module defines the result types returned by `store.execute()`.
 *
 * @module
 */

/**
 * Result of confirmation after sync.
 *
 * Used as the resolution type of {@link ExecuteResultPending.confirmation} so
 * consumers can pattern-match on success vs conflict.
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

  /**
   * Promise that rejects with the error.
   *
   * Allows callers who don't need to handle immediate failures to
   * access `.confirmation` directly without narrowing `_tag` first.
   * The rejection signals that no events were produced.
   */
  readonly confirmation: Promise<CommandConfirmation<TError>>
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
   * Promise that resolves when the command's events are confirmed by the sync backend,
   * or rejects for unexpected (thrown) errors.
   *
   * @example Await confirmation directly (ignores immediate failures)
   * ```ts
   * const confirmation = await store.execute(commands.toggleTodo({ id })).confirmation
   * if (confirmation._tag === 'conflict') {
   *   toast.error('Toggle rolled back')
   * }
   * ```
   *
   * @example Handle immediate failures first, then await confirmation
   * ```ts
   * const result = store.execute(commands.createTodo({ id, text }))
   *
   * if (result._tag === 'failed' && result.error._tag === 'TodoTextEmpty') {
   *   setError('Todo text cannot be empty.')
   *   return
   * }
   *
   * const confirmation = await result.confirmation
   * if (confirmation._tag === 'confirmed') {
   *   toast.success('Todo confirmed')
   * } else {
   *   toast.error(`Todo rolled back: ${confirmation.error}`)
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
 * Both variants expose a `confirmation` promise:
 * - `pending`: resolves to {@link CommandConfirmation} when sync completes
 * - `failed`: rejects immediately with the error (for callers who skip immediate failure handling)
 *
 * @example Only handle conflicts (skip immediate failures)
 * ```ts
 * const confirmation = await store.execute(commands.toggleTodo({ id })).confirmation
 * if (confirmation._tag === 'conflict') {
 *   toast.error('Action rolled back')
 * }
 * ```
 *
 * @example Handle immediate failures and conflicts
 * ```ts
 * const result = store.execute(commands.createTodo({ id, text }))
 *
 * if (result._tag === 'failed') {
 *   // result.error is TodoTextEmpty — fully typed
 *   console.error('Failed:', result.error)
 *   return
 * }
 *
 * const confirmation = await result.confirmation
 * if (confirmation._tag === 'conflict') {
 *   toast.error('Action rolled back')
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
