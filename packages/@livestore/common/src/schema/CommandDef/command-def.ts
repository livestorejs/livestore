import type { Schema } from '@livestore/utils/effect'

import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'
import type { QueryBuilder } from '../state/sqlite/query-builder/mod.ts'

/**
 * Function signature for querying current state within a command handler.
 *
 * Allows handlers to validate preconditions by reading existing data.
 * Can be called with a type-safe query builder or a raw SQL query.
 *
 * @example
 * ```ts
 * handler: (cmd, ctx) => {
 *   // With query builder
 *   const room = ctx.query(tables.rooms.get(cmd.roomId))
 *   if (!room) throw new Error('Room not found')
 *
 *   // With raw SQL
 *   const guestCount = ctx.query({
 *     query: 'SELECT COUNT(*) FROM roomGuests WHERE roomId = ?',
 *     bindValues: [cmd.roomId],
 *   })
 *   if (guestCount >= room.capacity) return new RoomAtCapacity()
 *
 *   return events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })
 * }
 * ```
 */
export type CommandHandlerContextQuery = {
  /** Query with a type-safe query builder. */
  <TResult>(qb: QueryBuilder<TResult, any, any>): TResult
  /** Query with raw SQL and bind values. */
  (args: { query: string; bindValues: Record<string, unknown> }): ReadonlyArray<unknown>
}

/**
 * Context provided to command handlers for validation and state queries.
 */
export interface CommandHandlerContext {
  /** Execute a synchronous query against the current state. */
  readonly query: CommandHandlerContextQuery
}

/**
 * Result of a command handler invocation.
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
 * Function type for validating a command and producing events.
 *
 * Handlers receive the decoded command arguments and a context with state
 * access. They should validate preconditions and return the events to be
 * committed, or return an error value for typed failure.
 *
 * Parameterized by the command definition type so that the arguments are
 * inferred from the schema, mirroring the {@link import('../EventDef/materializer.ts').Materializer | Materializer} pattern.
 *
 * @example Infallible handler (returns events only)
 * ```ts
 * const handler: CommandHandler<typeof checkInGuest> = (cmd, ctx) => {
 *   return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 * }
 * ```
 *
 * @example Fallible handler (may return an error value)
 * ```ts
 * class RoomNotFound { readonly _tag = 'RoomNotFound' as const }
 *
 * const handler: CommandHandler<typeof checkInGuest, RoomNotFound> = (cmd, ctx) => {
 *   const room = ctx.query(tables.rooms.get(cmd.roomId))
 *   if (!room) return new RoomNotFound()
 *   return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 * }
 * ```
 */
export type CommandHandler<
  TCommandDef extends { schema: Schema.Schema<any, any> } = CommandDef.AnyWithoutFn,
  TError = never,
> = (
  /** Decoded command arguments. */
  args: TCommandDef['schema']['Type'],
  context: CommandHandlerContext,
) => CommandHandlerResult<TError>

/**
 * Core type representing a command definition in LiveStore.
 *
 * A CommandDef defines the structure and behavior of a command type, including:
 * - A unique name identifying the command type
 * - A schema for validating command arguments
 * - A handler function that validates and produces events
 *
 * CommandDefs are callable - invoking them creates a command instance suitable for `store.execute()`.
 *
 * @example Infallible command (handler always returns events)
 * ```ts
 * import { defineCommand } from '@livestore/livestore'
 * import { Schema } from 'effect'
 *
 * const checkInGuest = defineCommand({
 *   name: 'CheckInGuest',
 *   schema: Schema.Struct({
 *     roomId: Schema.String,
 *     guestId: Schema.String,
 *   }),
 *   handler: (cmd, ctx) => {
 *     return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *   },
 * })
 * ```
 *
 * @example Fallible command (handler may return a typed error)
 * ```ts
 * class RoomNotFound { readonly _tag = 'RoomNotFound' as const }
 *
 * const checkInGuest = defineCommand({
 *   name: 'CheckInGuest',
 *   schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
 *   handler: (cmd, ctx) => {
 *     const room = ctx.query(tables.rooms.get(cmd.roomId))
 *     if (!room) return new RoomNotFound()
 *     return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *   },
 * })
 *
 * // result.error is RoomNotFound | CommandExecutionError — fully typed
 * const result = store.execute(checkInGuest({ roomId: 'room-1', guestId: 'guest-1' }))
 * ```
 */
export type CommandDef<TName extends string, TArgs, TEncoded = TArgs, TError = never> = {
  /** Type discriminator for CommandDef. */
  readonly _tag: 'CommandDef'

  /** Unique identifier for this command type. */
  readonly name: TName

  /** Effect Schema used for validating command arguments. */
  readonly schema: Schema.Schema<TArgs, TEncoded>

  /** Handler function that validates the command and produces events. */
  readonly handler: CommandHandler<CommandDef<TName, TArgs, TEncoded, TError>, TError>

  /**
   * Callable signature - creates a command instance with validated arguments.
   * The returned object can be passed directly to `store.execute()`.
   */
  (args: TArgs): CommandInstance<TName, TArgs, TError>
}

/** @internal Symbol used to brand CommandInstance with its error type. */
export declare const CommandInstanceTypeId: unique symbol

/**
 * A command instance ready to be executed.
 *
 * Created by calling a CommandDef with arguments.
 * Contains the command name, validated arguments, and a unique ID for tracking.
 *
 * The error type is carried via a branded field so TypeScript can infer `TError`
 * when passing the instance to `store.execute()`.
 */
export interface CommandInstance<TName extends string = string, TArgs = unknown, TError = unknown> {
  /** Type discriminator for CommandInstance. */
  readonly _tag: 'Command'

  /** The command type name. */
  readonly name: TName

  /** The validated command arguments. */
  readonly args: TArgs

  /** Unique identifier for this command instance, used for tracking and confirmation. */
  readonly id: string

  /** @internal Branded field carrying the error type for inference. Never set at runtime. */
  readonly [CommandInstanceTypeId]: TError
}

export namespace CommandDef {
  /**
   * Wildcard type matching any CommandDef regardless of type parameters.
   * Used as a type constraint in generic functions and collections.
   */
  export type Any = CommandDef<string, any, any, any>

  /**
   * CommandDef without the callable function signature.
   * Used in contexts where only the metadata (name, schema, handler) is needed.
   *
   * The handler is typed as a plain function rather than via {@link CommandHandler}
   * to avoid contravariance issues when assigning specific `CommandDef`s
   * (whose `TError` narrows the handler signature) to this wildcard type.
   */
  export type AnyWithoutFn = {
    readonly _tag: 'CommandDef'
    readonly name: string
    readonly schema: Schema.Schema<any, any>
    readonly handler: (args: any, context: CommandHandlerContext) => CommandHandlerResult<any>
  }
}

/**
 * Plain object record of command definitions keyed by name.
 * This is the typical shape when defining commands in user code.
 *
 * @example
 * ```ts
 * const commands = {
 *   checkInGuest: defineCommand({ name: 'CheckInGuest', schema: ..., handler: ... }),
 *   checkOutGuest: defineCommand({ name: 'CheckOutGuest', schema: ..., handler: ... }),
 * } satisfies CommandDefRecord
 * ```
 */
export type CommandDefRecord = {
  [name: string]: CommandDef.Any
}
