import { Events, makeSchema, Schema, State } from '@livestore/livestore'

const events = {
  TodoCreated: Events.synced({
    name: 'TodoCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
      completed: State.SQLite.integer({ default: 0 }),
    },
  }),
}

const materializers = State.SQLite.materializers(events, {
  TodoCreated: ({ id, title }) => tables.todos.insert({ id, title }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state, devtools: { alias: 'schema-todos' } })
