import { Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../../adapter-types.ts'
import { type Bindable, prepareBindValues } from '../../util.ts'
import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'
import { isQueryBuilder } from '../state/sqlite/query-builder/api.ts'
import { getResultSchema } from '../state/sqlite/query-builder/impl.ts'
import type { QueryBuilder } from '../state/sqlite/query-builder/mod.ts'
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
 *   const [row] = ctx.query({
 *     query: 'SELECT COUNT(*) as count FROM roomGuests WHERE roomId = ?',
 *     bindValues: [roomId],
 *   })
 *   if ((row as { count: number }).count >= room.capacity) return new RoomAtCapacity()
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
 *
 * @see {@link CommandHandlerContext.phase}
 *
 * @experimental Commands API is under active development. Currently, only
 * `'initial'` is used at runtime. The `'replay'` phase is defined for
 * forward compatibility, but command replay is not yet wired into the sync
 * pipeline.
 *
 */
export type CommandHandlerExecutionPhase = { readonly _tag: 'initial' } | { readonly _tag: 'replay' }

/**
 * Context provided to command handlers for validation and state queries.
 *
 * Provides read access to the current state and indicates **when** the handler
 * is running so handlers can adapt their behavior accordingly (e.g., return
 * alternative events during replay instead of returning an error).
 *
 * @experimental Commands API is under active development. Initial execution works, but
 * command replay, conflict detection, and sync confirmation are not yet implemented.
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
 * Used by {@link executeCommandHandler} to normalize handler return values
 * without requiring an Either wrapper in user code.
 */
export const normalizeHandlerResult = <TError>(
  result: CommandHandlerResult<TError>,
): { ok: true; events: ReadonlyArray<LiveStoreEvent.Input.Decoded> } | { ok: false; error: TError } => {
  if (Array.isArray(result) === true) return { ok: true, events: result }
  if (isEventInput(result) === true) return { ok: true, events: [result] }
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
 * Execute a command handler against the current database state and classify the outcome
 * into a discriminated union.
 *
 * @param handler - The command handler function to execute.
 * @param commandArgs - Decoded arguments for the command.
 * @param db - SQLite database used for state reads within the handler.
 * @param phaseTag - Command execution phase.
 * @returns A discriminated union indicating the outcome of the handler execution.
 */
export const executeCommandHandler = <TError>({
  handler,
  commandArgs,
  db,
  phaseTag,
}: {
  handler: (commandArgs: unknown, context: CommandHandlerContext) => CommandHandlerResult<TError>
  commandArgs: unknown
  db: SqliteDb
  phaseTag: CommandHandlerExecutionPhase['_tag']
}): CommandHandlerExecutionResult<TError> => {
  const context: CommandHandlerContext = { query: makeCommandQueryFn(db), phase: { _tag: phaseTag } }
  let rawResult: CommandHandlerResult<TError>
  try {
    rawResult = handler(commandArgs, context)
  } catch (cause) {
    return { _tag: 'threw', cause }
  }

  const normalized = normalizeHandlerResult(rawResult)
  if (normalized.ok === false) return { _tag: 'error', error: normalized.error }

  return { _tag: 'ok', events: normalized.events }
}

/**
 * Function type for validating a command and producing event(s) or error.
 *
 * Handlers receive the decoded command arguments and a {@link CommandHandlerContext} with state
 * access. They should validate invariants and return the events to be
 * committed, or return an error for expected and recoverable failures.
 * Thrown errors are treated as unexpected and non-recoverable.
 *
 * @experimental Commands API is under active development. Initial execution works, but
 * command replay, conflict detection, and sync confirmation are not yet implemented.
 *
 * @example
 * ```ts
 * const handler: CommandHandler = ({ roomId, guestId }, ctx) => {
 *   const room = ctx.query(tables.rooms.get(roomId))
 *   if (!room) throw new Error('Room not found')
 *   if (room.guestCount >= room.capacity) return new RoomAtCapacity()
 *   return events.guestCheckedIn({ roomId, guestId })
 * }
 * ```
 */
/**
 * Create a {@link CommandHandlerContextQuery} function backed by a given SQLite database.
 *
 * Supports both type-safe query builders and raw SQL queries.
 */
export const makeCommandQueryFn = (db: SqliteDb): CommandHandlerContextQuery =>
  ((rawQueryOrQueryBuilder: { query: string; bindValues: Bindable } | QueryBuilder.Any) => {
    if (isQueryBuilder(rawQueryOrQueryBuilder) === true) {
      const { query, bindValues } = rawQueryOrQueryBuilder.asSql()
      const rawResults = db.select(query, prepareBindValues(bindValues, query))
      const resultSchema = getResultSchema(rawQueryOrQueryBuilder)
      return Schema.decodeSync(resultSchema)(rawResults)
    } else {
      const { query, bindValues } = rawQueryOrQueryBuilder
      return db.select(query, prepareBindValues(bindValues, query))
    }
  })

export type CommandHandler<
  TCommandDef extends { schema: Schema.Schema<any, any> } = CommandDef.AnyWithoutFn,
  TError = never,
> = (
  /** Decoded command arguments. */
  commandArgs: TCommandDef['schema']['Type'],
  context: CommandHandlerContext,
) => CommandHandlerResult<TError>
