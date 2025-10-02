import { defineMaterializer, Events, Schema, State } from '@livestore/livestore'

import { todos } from './example.ts'

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean.pipe(Schema.optional),
    }),
  }),
} as const

export const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text, completed }, ctx) => {
    const previousIds = ctx.query(todos.select('id'))
    return todos.insert({ id, text, completed: completed ?? false, previousIds })
  }),
})
