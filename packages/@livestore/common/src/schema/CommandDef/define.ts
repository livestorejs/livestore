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
 * // Define commands for your application
 * export const commands = {
 *   checkInGuest: defineCommand({
 *     name: 'CheckInGuest',
 *     schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
 *     handler: (cmd, ctx) => {
 *       const room = ctx.query(tables.rooms.get(cmd.roomId))
 *       if (!room) throw new Error("Room not found")
 *       if (room.guestCount >= room.capacity) throw new Error("Room at capacity")
 *       return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *     },
 *   }),
 * }
 * ```
 * @module
 */

import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type { CommandDef, CommandHandler, CommandInstance } from './command-def.ts'

/**
 * Creates a command definition.
 *
 * Commands encode user intentions that can be re-evaluated during sync.
 * The handler validates the command against current state and produces events.
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
 *     const guestCount = ctx.query(tables.roomGuests.where({ roomId: cmd.roomId }).count())
 *
 *     if (!room) {
 *       throw new Error("Room not found")
 *     }
 *
 *     if (guestCount >= room.capacity) {
 *       throw new Error("Room is at capacity")
 *     }
 *
 *     return [events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })]
 *   },
 * })
 *
 * // Execute the command
 * const result = store.execute(checkInGuest({ roomId: 'room-1', guestId: 'guest-1' }))
 *
 * if (result._tag === 'failed') {
 *   console.error(result.error.message)
 * } else {
 *   // Events are materialized locally, await server confirmation
 *   await result.confirmed
 * }
 * ```
 */
export const defineCommand = <TName extends string, TArgs, TEncoded = TArgs>(options: {
  name: TName
  schema: Schema.Schema<TArgs, TEncoded>
  handler: CommandHandler<{ schema: Schema.Schema<TArgs, TEncoded> }>
}): CommandDef<TName, TArgs, TEncoded> => {
  const { name, schema, handler } = options

  const makeCommand = (args: TArgs): CommandInstance<TName, TArgs> => {
    const validation = Schema.validateEither(schema)(args)
    if (validation._tag === 'Left') {
      shouldNeverHappen(`Invalid command args for command '${name}':`, validation.left.message, '\n')
    }

    return {
      _tag: 'Command',
      name,
      args,
      id: nanoid(),
    }
  }

  // Attach metadata to function
  Object.defineProperty(makeCommand, '_tag', { value: 'CommandDef' })
  Object.defineProperty(makeCommand, 'name', { value: name })
  Object.defineProperty(makeCommand, 'schema', { value: schema })
  Object.defineProperty(makeCommand, 'handler', { value: handler })

  return makeCommand as CommandDef<TName, TArgs, TEncoded>
}
