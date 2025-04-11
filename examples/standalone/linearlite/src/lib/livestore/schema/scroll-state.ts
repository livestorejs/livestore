import { State, Schema } from '@livestore/livestore'

export const ScrollState = Schema.Struct({
  list: Schema.optional(Schema.Number),
  backlog: Schema.optional(Schema.Number),
  todo: Schema.optional(Schema.Number),
  in_progress: Schema.optional(Schema.Number),
  done: Schema.optional(Schema.Number),
  canceled: Schema.optional(Schema.Number),
})
export type ScrollState = typeof ScrollState.Type

export const scrollState = State.SQLite.table('scroll_state', State.SQLite.json({ schema: ScrollState, default: {} }), {
  deriveEvents: true,
})
