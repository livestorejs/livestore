import { defineMaterializer, Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
      createdAt: State.SQLite.datetime(),
    },
  }),
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({
      newTodoText: Schema.String,
      filter: Schema.Literal('all', 'active', 'completed'),
    }),
    default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' } },
  }),
} as const

export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, createdAt: Schema.Date }),
  }),
} as const

const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text, createdAt }) =>
    tables.todos.insert({ id, text, completed: false, createdAt }),
  ),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
