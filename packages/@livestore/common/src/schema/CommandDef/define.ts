/**
 * Command Definition Functions
 *
 * This module provides functions for creating command definitions in LiveStore.
 * Commands represent user intentions that can be validated against current state
 * and re-evaluated during sync reconciliation.
 *
 * @example
 * ```ts
 * import { defineCommand, Schema } from '@livestore/livestore'
 *
 * // Infallible command — handler always returns events
 * export const commands = {
 *   checkInGuest: defineCommand({
 *     name: 'CheckInGuest',
 *     schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
 *     handler: (cmd, ctx) => {
 *       return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *     },
 *   }),
 * }
 * ```
 *
 * @example
 * ```ts
 * // Fallible command — handler may return a typed error value
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
 * ```
 * @module
 */

import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type { CommandDef, CommandHandlerContext, CommandInstance, ExtractCommandError } from './command-def.ts'

/**
 * Creates a command definition.
 *
 * Commands encode user intentions that can be re-evaluated during sync.
 * The handler validates the command against current state and produces events,
 * or returns an error value for typed failure handling.
 *
 * @example Infallible command
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
 *
 * const result = store.execute(checkInGuest({ roomId: 'room-1', guestId: 'guest-1' }))
 * ```
 *
 * @example Fallible command with typed error
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
 * const result = store.execute(checkInGuest({ roomId: 'room-1', guestId: 'guest-1' }))
 * if (result._tag === 'failed') {
 *   // result.error is RoomNotFound | CommandExecutionError — fully typed
 *   console.error(result.error)
 * }
 * ```
 */
export const defineCommand = <TName extends string, TArgs, TEncoded = TArgs, TReturn = ReadonlyArray<any>>(options: {
  name: TName
  schema: Schema.Schema<TArgs, TEncoded>
  handler: (args: Schema.Schema.Type<Schema.Schema<TArgs, TEncoded>>, context: CommandHandlerContext) => TReturn
}): CommandDef<TName, TArgs, TEncoded, ExtractCommandError<TReturn>> => {
  type TError = ExtractCommandError<TReturn>

  const { name, schema, handler } = options

  const makeCommand = (args: TArgs): CommandInstance<TName, TArgs, TError> => {
    const validation = Schema.validateEither(schema)(args)
    if (validation._tag === 'Left') {
      shouldNeverHappen(`Invalid command args for command '${name}':`, validation.left.message, '\n')
    }

    // The CommandInstanceTypeId field is a compile-time brand only — not set at runtime.
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
