import type { Schema } from '@livestore/utils/effect'

import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'
import type { QueryBuilder } from '../state/sqlite/query-builder/mod.ts'
import type { Bindable } from '../../util.ts'
import type { CommandDef } from './command-def.ts'

/**
 * Function signature for querying current state within a command handler.
 *
 * Allows handlers to validate invariants by reading existing data.
 * Can be called with a type-safe query builder or a raw SQL query.
 *
 * @example
 * ```ts
 * handler: ({ roomId, guestId }, ctx) => {
 *   // With query builder
 *   const room = ctx.query(tables.rooms.get(roomId))
 *   if (!room) throw new Error('Room not found')
 *
 *   // With raw SQL
 *   const guestCount = ctx.query({
 *     query: 'SELECT COUNT(*) FROM roomGuests WHERE roomId = ?',
 *     bindValues: [roomId],
 *   })
 *   if (guestCount >= room.capacity) return new RoomAtCapacity()
 *
 *   return events.guestCheckedIn({ roomId, guestId })
 * }
 * ```
 */
export type CommandHandlerContextQuery = {
  /** Query with a type-safe query builder. */
  <TResult>(qb: QueryBuilder<TResult, any, any>): TResult
  /** Query with raw SQL and bind values. */
  (args: { query: string; bindValues: Bindable }): ReadonlyArray<unknown>
}

/**
 * Discriminated union indicating the execution phase of a command handler.
 *
 * - `'initial'` — initial and immediate execution via `store.execute()`
 * - `'replay'` — re-execution after pulling new events
 */
export type CommandHandlerExecutionPhase = { readonly _tag: 'initial' } | { readonly _tag: 'replay' }

/**
 * Context provided to command handlers for validation and state queries.
 *
 * Handlers receive this as their second argument. It provides read access to
 * the current state and indicates **when** the handler is running so handlers
 * can adapt their behavior accordingly (e.g. return alternative events during
 * replay instead of returning an error).
 *
 * @example
 * ```ts
 * handler: ({ roomId, guestId }, ctx) => {
 *   const room = ctx.query(tables.rooms.get(roomId))
 *   const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
 *
 *   if (guestCount >= room.capacity) {
 *     // During replay, adapt instead of erroring to avoid unnecessary conflicts
 *     if (ctx.phase._tag === 'replay') return events.guestWaitlisted({ roomId, guestId })
 *     return new RoomAtCapacity()
 *   }
 *
 *   return events.guestCheckedIn({ roomId, guestId })
 * }
 * ```
 */
export interface CommandHandlerContext {
  /** Execute a synchronous query against the current state. */
  readonly query: CommandHandlerContextQuery

  /**
   * Indicates whether the handler is running during:
   * - `'initial'` — initial and immediate execution via `store.execute()`
   * - `'replay'` — re-execution after pulling new events
   *
   * Use this to tailor behavior: e.g. return an error during `'initial'` so the
   * UI can show immediate feedback to the user, but return alternative events during `'replay'`
   * to handle conflicts gracefully within your domain logic.
   */
  readonly phase: CommandHandlerExecutionPhase
}

/**
 * Result of a command handler execution.
 *
 * Handlers return either a single event, an array of events, or an error.
 * The runtime distinguishes events from errors via `Array.isArray` and duck-typing
 * (single events have `name` + `args` properties).
 */
export type CommandHandlerResult<TError> =
  | ReadonlyArray<LiveStoreEvent.Input.Decoded>
  | LiveStoreEvent.Input.Decoded
  | TError

/**
 * Extracts the error type from a handler's full return type by excluding event branches.
 *
 * Used by `defineCommand` to compute `TError` from the inferred return type so that
 * TypeScript doesn't conflate the event branches with the error branch during inference.
 */
export type ExtractCommandError<TReturn> = Exclude<TReturn, ReadonlyArray<any> | LiveStoreEvent.Input.Decoded>

// TODO: Replace duck-typing with Symbol TypeId brand (https://github.com/livestorejs/livestore/issues/1015)
/** Runtime check for the `{ name, args }` shape of a single decoded event. */
const isEventInput = (value: unknown): value is LiveStoreEvent.Input.Decoded =>
  typeof value === 'object' && value !== null && 'name' in value && 'args' in value

/**
 * Distinguishes events (array or single) from errors in a handler result.
 *
 * Used by `store.execute()` and `executeCommandHandler` in replay to normalize
 * handler return values without requiring an Either wrapper in user code.
 */
export const normalizeHandlerResult = <TError>(
  result: CommandHandlerResult<TError>,
): { ok: true; events: ReadonlyArray<LiveStoreEvent.Input.Decoded> } | { ok: false; error: TError } => {
  if (Array.isArray(result)) return { ok: true, events: result }
  if (isEventInput(result)) return { ok: true, events: [result] }
  return { ok: false, error: result as TError }
}

/**
 * Full outcome of a command handler invocation, including thrown errors.
 *
 * This helper keeps execution semantics consistent between initial execution
 * (`store.execute`) and replay (`LeaderSyncProcessor`).
 */
export type CommandHandlerExecutionResult<TError> =
  | { readonly _tag: 'ok'; readonly events: ReadonlyArray<LiveStoreEvent.Input.Decoded> }
  | { readonly _tag: 'error'; readonly error: TError }
  | { readonly _tag: 'threw'; readonly cause: unknown }

/**
 * Execute a command handler and classify the outcome.
 *
 * - Returned event(s) => `{ _tag: 'ok' }`
 * - Returned recoverable error => `{ _tag: 'error' }`
 * - Thrown unexpected error => `{ _tag: 'threw' }`
 */
export const executeCommandHandler = <TError>(
  handler: (commandArgs: unknown, context: CommandHandlerContext) => CommandHandlerResult<TError>,
  commandArgs: unknown,
  context: CommandHandlerContext,
): CommandHandlerExecutionResult<TError> => {
  let rawResult: CommandHandlerResult<TError>
  try {
    rawResult = handler(commandArgs, context)
  } catch (cause) {
    return { _tag: 'threw', cause }
  }

  const normalized = normalizeHandlerResult(rawResult)
  if (!normalized.ok) {
    return { _tag: 'error', error: normalized.error }
  }
  return { _tag: 'ok', events: normalized.events }
}

/**
 * Function type for validating a command and producing event(s) or error.
 *
 * Handlers receive the decoded command arguments and a context with state
 * access. They should validate invariants and return the events to be
 * committed, or return an error for expected and recoverable failures.
 */
export type CommandHandler<
  TCommandDef extends { schema: Schema.Schema<any, any> } = CommandDef.AnyWithoutFn,
  TError = never,
> = (
  /** Decoded command arguments. */
  commandArgs: TCommandDef['schema']['Type'],
  context: CommandHandlerContext,
) => CommandHandlerResult<TError>
