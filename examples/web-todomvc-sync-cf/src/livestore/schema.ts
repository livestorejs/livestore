import { Events, makeSchema, Schema, State } from '@livestore/livestore'

export const TodoFilter = Schema.Literals(['all', 'active', 'completed'])

// You can model your state as SQLite tables (https://docs.livestore.dev/reference/state/sqlite-schema)
export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromMillis }),
    },
  }),
  // Client-only state uses an ordinary table and explicit client-only events.
  uiState: State.SQLite.table({
    name: 'uiState',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      newTodoText: State.SQLite.text({ default: '' }),
      filter: State.SQLite.text({ schema: TodoFilter, default: 'all' }),
    },
  }),
}

// Events describe data changes (https://docs.livestore.dev/reference/events)
export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.TodoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.TodoDeleted',
    schema: Schema.Struct({
      id: Schema.String,
      deletedAt: Schema.DateFromString.check(Schema.isDateValid()),
    }),
  }),
  todoClearedCompleted: Events.synced({
    name: 'v1.TodoClearedCompleted',
    schema: Schema.Struct({ deletedAt: Schema.DateFromString.check(Schema.isDateValid()) }),
  }),
  todoDraftChanged: Events.clientOnly({
    name: 'v1.TodoDraftChanged',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoFilterChanged: Events.clientOnly({
    name: 'v1.TodoFilterChanged',
    schema: Schema.Struct({ id: Schema.String, filter: TodoFilter }),
  }),
}

// Materializers are used to map events to state (https://docs.livestore.dev/reference/state/materializers)
const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => tables.todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => tables.todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => tables.todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => tables.todos.update({ deletedAt }).where({ completed: true }),
  'v1.TodoDraftChanged': ({ id, text }) =>
    tables.uiState.insert({ id, newTodoText: text, filter: 'all' }).onConflict('id', 'update', { newTodoText: text }),
  'v1.TodoFilterChanged': ({ id, filter }) =>
    tables.uiState.insert({ id, newTodoText: '', filter }).onConflict('id', 'update', { filter }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Shared sync payload schema for this example
export const SyncPayload = Schema.Struct({ authToken: Schema.String })
