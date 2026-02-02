import type { Schema } from '@livestore/utils/effect'

import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'

/**
 * Context provided to command handlers for validation and state queries.
 */
export interface CommandHandlerContext {
  /** State access for validation queries. */
  readonly state: {
    /**
     * Execute a synchronous query against the current state.
     * Use this to validate command preconditions.
     *
     * Accepts query builders, live query definitions, or raw queries.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: <TResult>(query: any) => TResult
  }
}

/**
 * Handler function that validates a command and produces events.
 *
 * Handlers receive the command arguments and a context with state access.
 * They should validate preconditions and return the events to be committed.
 *
 * @example
 * ```ts
 * const handler: CommandHandler<{ roomId: string; guestId: string }> = (cmd, { state }) => {
 *   const room = state.query(tables.rooms.get(cmd.roomId))
 *   if (!room) throw new Error("Room not found")
 *   if (room.guestCount >= room.capacity) throw new Error("Room at capacity")
 *   return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 * }
 * ```
 */
export type CommandHandler<TArgs> = (
  args: TArgs,
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
 *   handler: (cmd, { state }) => {
 *     const room = state.query(tables.rooms.get(cmd.roomId))
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
  readonly handler: CommandHandler<TArgs>

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
 * Container holding a Map of command definitions keyed by name.
 * Used internally by LiveStoreSchema.
 */
export type CommandDefMap = {
  map: Map<string, CommandDef.Any>
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
