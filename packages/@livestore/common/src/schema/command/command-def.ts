import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

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
 * Commands encode user intentions that can be re-evaluated during reconciliation.
 * The handler validates the command against the current state, and returns event(s)
 * or an error for expected and recoverable failures.
 */
export function defineCommand<TName extends string, TArgs, TEncoded = TArgs, TReturn = ReadonlyArray<any>>(options: {
  name: TName
  schema: Schema.Schema<TArgs, TEncoded>
  handler: (commandArgs: Schema.Schema.Type<Schema.Schema<TArgs, TEncoded>>, context: CommandHandlerContext) => TReturn
}): CommandDef<TName, TArgs, TEncoded, ExtractCommandError<TReturn>> {
  type TError = ExtractCommandError<TReturn>

  const { name, schema, handler } = options

  const makeCommand = (commandArgs: TArgs) => {
    const validation = Schema.validateEither(schema)(commandArgs)
    if (validation._tag === 'Left') {
      shouldNeverHappen(`Invalid command args for command '${name}':`, validation.left.message, '\n')
    }

    return makeCommandInstance<TName, TArgs, TError>({ name, args: commandArgs, id: nanoid() })
  }

  // Attach metadata to function
  Object.defineProperty(makeCommand, 'name', { value: name })
  Object.defineProperty(makeCommand, 'schema', { value: schema })
  Object.defineProperty(makeCommand, 'handler', { value: handler })

  return makeCommand as CommandDef<TName, TArgs, TEncoded, TError>
}
