import { defineMaterializer, Events, makeSchema, Schema, State } from '@livestore/livestore'

export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({ text: Schema.String }),
    default: { value: { text: '' } },
  }),
} as const

export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
} as const

const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text }) =>
    tables.todos.insert({ id, text, completed: false }),
  ),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
