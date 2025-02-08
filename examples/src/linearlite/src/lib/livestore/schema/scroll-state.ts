import { DbSchema } from '@livestore/livestore'
import { Schema } from 'effect'

export const SrollState = Schema.Struct({
  list: Schema.optional(Schema.Number),
  backlog: Schema.optional(Schema.Number),
  todo: Schema.optional(Schema.Number),
  in_progress: Schema.optional(Schema.Number),
  done: Schema.optional(Schema.Number),
  canceled: Schema.optional(Schema.Number),
})
export type ScrollState = typeof SrollState.Type

export const scrollState = DbSchema.table('scroll_state', DbSchema.json({ schema: SrollState, default: {} }), {
  deriveMutations: { enabled: true, localOnly: true },
})
