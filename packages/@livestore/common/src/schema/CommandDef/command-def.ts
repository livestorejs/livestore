import type { Schema } from '@livestore/utils/effect'

import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'
import type { QueryBuilder } from '../state/sqlite/query-builder/mod.ts'

/**
 * Function signature for querying current state within a command handler.
 *
 * Allows handlers to validate preconditions by reading existing data.
 * Can be called with a type-safe QueryBuilder or a raw SQL query.
 *
 * @example
 * ```ts
 * handler: (cmd, ctx) => {
 *   const room = ctx.query(tables.rooms.get(cmd.roomId))
 *   if (!room) throw new Error("Room not found")
 *   return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 * }
 * ```
 */
export type CommandHandlerContextQuery = {
  /** Query with a type-safe QueryBuilder. */
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
 * Function type for validating a command and producing events.
 *
 * Handlers receive the decoded command arguments and a context with state
 * access. They should validate preconditions and return the events to be
 * committed.
 *
 * Parameterized by the command definition type so that the arguments are
 * inferred from the schema, mirroring the {@link import('../EventDef/materializer.ts').Materializer | Materializer} pattern.
 *
 * @example
 * ```ts
 * const handler: CommandHandler<typeof checkInGuest> = (cmd, ctx) => {
 *   const room = ctx.query(tables.rooms.get(cmd.roomId))
 *   if (!room) throw new Error("Room not found")
 *   if (room.guestCount >= room.capacity) throw new Error("Room at capacity")
 *   return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 * }
 * ```
 */
export type CommandHandler<
  TCommandDef extends { schema: Schema.Schema<any, any> } = CommandDef.AnyWithoutFn,
> = (
  /** Decoded command arguments. */
  args: TCommandDef['schema']['Type'],
  context: CommandHandlerContext,
) => ReadonlyArray<LiveStoreEvent.Input.Decoded>

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
 * @example
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
 *     const room = ctx.query(tables.rooms.get(cmd.roomId))
 *     if (!room) throw new Error("Room not found")
 *     return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *   },
 * })
 *
 * // Use the CommandDef as a constructor
 * const result = store.execute(checkInGuest({ roomId: 'room-1', guestId: 'guest-1' }))
 * ```
 */
export type CommandDef<TName extends string, TArgs, TEncoded = TArgs> = {
  /** Type discriminator for CommandDef. */
  readonly _tag: 'CommandDef'

  /** Unique identifier for this command type. */
  readonly name: TName

  /** Effect Schema used for validating command arguments. */
  readonly schema: Schema.Schema<TArgs, TEncoded>

  /** Handler function that validates the command and produces events. */
  readonly handler: CommandHandler<CommandDef<TName, TArgs, TEncoded>>

  /**
   * Callable signature - creates a command instance with validated arguments.
   * The returned object can be passed directly to `store.execute()`.
   */
  (args: TArgs): CommandInstance<TName, TArgs>
}

/**
 * A command instance ready to be executed.
 *
 * Created by calling a CommandDef with arguments.
 * Contains the command name, validated arguments, and a unique ID for tracking.
 */
export interface CommandInstance<TName extends string = string, TArgs = unknown> {
  /** Type discriminator for CommandInstance. */
  readonly _tag: 'Command'

  /** The command type name. */
  readonly name: TName

  /** The validated command arguments. */
  readonly args: TArgs

  /** Unique identifier for this command instance, used for tracking and confirmation. */
  readonly id: string
}

export namespace CommandDef {
  /**
   * Wildcard type matching any CommandDef regardless of type parameters.
   * Used as a type constraint in generic functions and collections.
   */
  export type Any = CommandDef<string, any, any>

  /**
   * CommandDef without the callable function signature.
   * Used in contexts where only the metadata (name, schema, handler) is needed.
   */
  export type AnyWithoutFn = Pick<Any, '_tag' | 'name' | 'schema' | 'handler'>
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
