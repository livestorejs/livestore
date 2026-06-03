import { defineMaterializer, Events, makeSchema, Schema, State } from '@livestore/livestore'

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
  uiState: State.SQLite.table({
    name: 'UiState',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      newTodoText: State.SQLite.text({ default: '' }),
      filter: State.SQLite.text({ schema: Schema.Literal('all', 'active', 'completed'), default: 'all' }),
    },
  }),
} as const

export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, createdAt: Schema.Date }),
  }),
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.Struct({
      newTodoText: Schema.String.pipe(Schema.optional),
      filter: Schema.Literal('all', 'active', 'completed').pipe(Schema.optional),
    }),
  }),
} as const

const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text, createdAt }) =>
    tables.todos.insert({ id, text, completed: false, createdAt }),
  ),
  [events.uiStateSet.name]: defineMaterializer(events.uiStateSet, ({ newTodoText, filter }) =>
    tables.uiState
      .insert({ id: 'default', newTodoText: newTodoText ?? '', filter: filter ?? 'all' })
      .onConflict('id', 'update', {
        ...(newTodoText === undefined ? {} : { newTodoText }),
        ...(filter === undefined ? {} : { filter }),
      }),
  ),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
