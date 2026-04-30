import { Schema, State } from '@livestore/livestore'

export const ScrollState = Schema.Struct({
  list: Schema.Number,
  backlog: Schema.optional(Schema.Number),
  todo: Schema.optional(Schema.Number),
  in_progress: Schema.optional(Schema.Number),
  done: Schema.optional(Schema.Number),
  canceled: Schema.optional(Schema.Number),
})

export type ScrollState = typeof ScrollState.Type

export const scrollState = State.SQLite.clientDocument({
  name: 'scroll_state',
  schema: ScrollState,
  default: { value: { list: 0 } },
})
