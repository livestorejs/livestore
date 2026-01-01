// schema.ts
import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// 1. Define events (the things that can happen in your app)
export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
    }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

// 2. Define SQLite tables (how to query your state)
export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
}

// 3. Define materializers (how to turn events into state)
const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => tables.todos.insert({ id, text }),
  'v1.TodoCompleted': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
})

const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ events, state })
