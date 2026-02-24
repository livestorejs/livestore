import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type {
  CommandHandler,
  CommandHandlerContext,
  CommandHandlerResult,
  ExtractCommandError,
} from './command-handler.ts'
import { type CommandInstance, makeCommandInstance } from './command-instance.ts'

/**
 * Core type representing a command definition in LiveStore.
 *
 * A CommandDef defines the structure and behavior of a command type, including:
 * - A unique name identifying the command type
 * - A schema for validating command arguments
 * - A handler function that validates invariants and produces event(s) or error
 *
 * CommandDefs are callable - invoking them creates a command instance suitable for `store.execute()`.
 *
 * @experimental Commands API is under active development. Initial execution works, but
 * command replay, conflict detection, and sync confirmation are not yet implemented.
 */
export type CommandDef<TName extends string, TArgs, TEncoded = TArgs, TError = never> = {
  /** Unique identifier for this command type. */
  readonly name: TName

  /** Effect Schema used for validating command arguments. */
  readonly schema: Schema.Schema<TArgs, TEncoded>

  /** Handler function that validates invariants and produces event(s) or error. */
  readonly handler: CommandHandler<CommandDef<TName, TArgs, TEncoded, TError>, TError>

  /**
   * Callable signature - creates a command instance with validated arguments.
   * The returned object can be passed directly to `store.execute()`.
   */
  (args: TArgs): CommandInstance<TName, TArgs, TError>
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

/**
 * Creates a command definition.
 *
 * Commands encode user intentions that can be re-evaluated during sync (command replay).
 * The handler validates the command against the current state, and returns event(s)
 * or an error for expected and recoverable failures.
 *
 * @param options.name - Unique name identifying the command type.
 * @param options.schema - An {@link Schema.Schema} for validating command arguments.
 * @param options.handler - Function that validates invariants against the current state and
 *   returns event(s) or a recoverable error. See {@link CommandHandler}.
 * @returns A callable {@link CommandDef} — invoke it with arguments to create a
 *   {@link CommandInstance} suitable for {@link Store.execute}.
 *
 * @experimental Commands API is under active development. Initial execution works but
 * command replay, conflict detection, and sync confirmation are not yet implemented.
 *
 * @example
 * ```ts
 * import { defineCommand, Schema } from '@livestore/livestore'
 *
 * class RoomAtCapacity extends Schema.TaggedError<RoomAtCapacity>()('RoomAtCapacity', {}) {}
 *
 * const checkInGuest = defineCommand({
 *   name: 'CheckInGuest',
 *   schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
 *   handler: ({ roomId, guestId }, ctx) => {
 *     const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
 *     if (guestCount >= 2) return new RoomAtCapacity()
 *     return events.guestCheckedIn({ roomId, guestId })
 *   },
 * })
 * ```
 */
export const defineCommand = <TName extends string, TArgs, TEncoded = TArgs, TReturn = ReadonlyArray<any>>(options: {
  name: TName
  schema: Schema.Schema<TArgs, TEncoded>
  handler: (commandArgs: Schema.Schema.Type<Schema.Schema<TArgs, TEncoded>>, context: CommandHandlerContext) => TReturn
}): CommandDef<TName, TArgs, TEncoded, ExtractCommandError<TReturn>> => {
  type TError = ExtractCommandError<TReturn>

  const { name, schema, handler } = options

  const makeCommand = (commandArgs: TArgs) => {
    const validation = Schema.validateEither(schema)(commandArgs)
    if (validation._tag === 'Left') {
      shouldNeverHappen(`Invalid command args for command '${name}':`, validation.left.message, '\n')
    }

    return makeCommandInstance<TName, TArgs, TError>({ name, args: commandArgs })
  }

  // Attach metadata to function
  Object.defineProperty(makeCommand, 'name', { value: name })
  Object.defineProperty(makeCommand, 'schema', { value: schema })
  Object.defineProperty(makeCommand, 'handler', { value: handler })

  return makeCommand as CommandDef<TName, TArgs, TEncoded, TError>
}
