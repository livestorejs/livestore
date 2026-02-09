import { Events, makeSchema, Schema, State } from '@livestore/livestore'

const aTables = makeTodoTables()
const aEvents = {
  todoCreated: Events.synced({
    name: 'v1.A.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.A.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.A.TodoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.A.TodoDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  todoClearedCompleted: Events.synced({
    name: 'v1.A.TodoClearedCompleted',
    schema: Schema.Struct({ deletedAt: Schema.Date }),
  }),
}

const a = {
  tables: aTables,
  events: aEvents,
  backend: State.SQLite.makeBackend({
    id: 'a',
    tables: aTables,
    materializers: State.SQLite.materializers(aEvents, {
      'v1.A.TodoCreated': ({ id, text }) => aTables.todos.insert({ id, text, completed: false }),
      'v1.A.TodoCompleted': ({ id }) => aTables.todos.update({ completed: true }).where({ id }),
      'v1.A.TodoUncompleted': ({ id }) => aTables.todos.update({ completed: false }).where({ id }),
      'v1.A.TodoDeleted': ({ id, deletedAt }) => aTables.todos.update({ deletedAt }).where({ id }),
      'v1.A.TodoClearedCompleted': ({ deletedAt }) => aTables.todos.update({ deletedAt }).where({ completed: true }),
    }),
  }),
}

const bTables = makeTodoTables()
const bEvents = {
  todoCreated: Events.synced({
    name: 'v1.B.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.B.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.B.TodoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.B.TodoDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  todoClearedCompleted: Events.synced({
    name: 'v1.B.TodoClearedCompleted',
    schema: Schema.Struct({ deletedAt: Schema.Date }),
  }),
}

const b = {
  tables: bTables,
  events: bEvents,
  backend: State.SQLite.makeBackend({
    id: 'b',
    tables: bTables,
    materializers: State.SQLite.materializers(bEvents, {
      'v1.B.TodoCreated': ({ id, text }) => bTables.todos.insert({ id, text, completed: false }),
      'v1.B.TodoCompleted': ({ id }) => bTables.todos.update({ completed: true }).where({ id }),
      'v1.B.TodoUncompleted': ({ id }) => bTables.todos.update({ completed: false }).where({ id }),
      'v1.B.TodoDeleted': ({ id, deletedAt }) => bTables.todos.update({ deletedAt }).where({ id }),
      'v1.B.TodoClearedCompleted': ({ deletedAt }) => bTables.todos.update({ deletedAt }).where({ completed: true }),
    }),
  }),
}

export const tables = { a: a.tables, b: b.tables }

export const events = { a: a.events, b: b.events }

export const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [a.backend, b.backend] }),
  events: [...Object.values(a.events), ...Object.values(b.events)],
  devtools: { alias: 'multi-state-todo' },
})

function makeTodoTables() {
  return {
    todos: State.SQLite.table({
      name: 'todos',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        text: State.SQLite.text({ default: '' }),
        completed: State.SQLite.boolean({ default: false }),
        deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      },
    }),
  }
}
