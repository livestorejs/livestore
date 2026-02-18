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
 * consumers can pattern-match on confirmed vs. conflict:
 *
 * - `confirmed`: Command's event(s) were pushed and confirmed by the sync backend
 * - `conflict`: Command's handler returned an error during command replay
 */
export type CommandConfirmation<TError = unknown> =
  | { readonly _tag: 'confirmed' }
  | { readonly _tag: 'conflict'; readonly error: TError }

/**
 * Result of a failed initial command execution.
 *
 * Returned when the command handler returns an error during initial execution.
 */
export interface ExecuteResultFailed<TError = unknown> {
  /** Type discriminator for a failed result. */
  readonly _tag: 'failed'

  /** The error returned by the command handler. */
  readonly error: TError

  /**
   * Promise that rejects with the error.
   *
   * Allows callers who don't need to handle initial execution failures to
   * access `.confirmation` directly without narrowing `_tag` first.
   *
   * It rejects when the command handler returns an error during initial
   * execution since awaiting `.confirmation` directly implies we aren't expecting
   * initial execution failures.
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
   * Promise that resolves when the command's event(s) are confirmed by the sync backend
   * or an error is returned by the command handler during command replay.
   *
   * Rejects when the command handler throws (unexpected and non-recoverable) an error
   * during command replay.
   *
   * @example Await confirmation directly (skips initial execution failures)
   * ```ts
   * const confirmation = await store.execute(commands.toggleTodo({ id })).confirmation
   * if (confirmation._tag === 'conflict') {
   *   toast.error('Toggle rolled back')
   * }
   * ```
   *
   * @example Handle initial execution failures first, then await confirmation
   * ```ts
   * const result = store.execute(commands.createTodo({ id, text }))
   *
   * if (result._tag === 'failed' && result.error._tag === 'TodoTextEmpty') {
   *   toast.error('Todo text cannot be empty.')
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
 * Commands either fail during initial execution (`failed`)
 * or succeed with pending confirmation (`pending`).
 *
 * Both variants expose a `confirmation` promise:
 * - `pending`: resolves to {@link CommandConfirmation} when sync completes
 * - `failed`: rejects with the error (for callers who skip initial execution failure handling)
 *
 * @example Only handle conflicts (skip initial execution failures)
 * ```ts
 * const confirmation = await store.execute(commands.toggleTodo({ id })).confirmation
 * if (confirmation._tag === 'conflict') {
 *   toast.error('Action rolled back')
 * }
 * ```
 *
 * @example Handle initial execution failures and conflicts
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
