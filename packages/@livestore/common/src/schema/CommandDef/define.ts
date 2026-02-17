import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type { CommandDef, CommandHandlerContext, CommandInstance, ExtractCommandError } from './command-def.ts'

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
  handler: (args: Schema.Schema.Type<Schema.Schema<TArgs, TEncoded>>, context: CommandHandlerContext) => TReturn
}): CommandDef<TName, TArgs, TEncoded, ExtractCommandError<TReturn>> {
  type TError = ExtractCommandError<TReturn>

  const { name, schema, handler } = options

  const makeCommand = (args: TArgs): CommandInstance<TName, TArgs, TError> => {
    const validation = Schema.validateEither(schema)(args)
    if (validation._tag === 'Left') {
      shouldNeverHappen(`Invalid command args for command '${name}':`, validation.left.message, '\n')
    }

    return {
      _tag: 'Command',
      name,
      args,
      id: nanoid(),
    } as CommandInstance<TName, TArgs, TError>
  }

  // Attach metadata to function
  Object.defineProperty(makeCommand, '_tag', { value: 'CommandDef' })
  Object.defineProperty(makeCommand, 'name', { value: name })
  Object.defineProperty(makeCommand, 'schema', { value: schema })
  Object.defineProperty(makeCommand, 'handler', { value: handler })

  return makeCommand as CommandDef<TName, TArgs, TEncoded, TError>
}
