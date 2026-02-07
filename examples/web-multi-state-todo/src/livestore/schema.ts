import { Events, makeSchema, Schema, State } from '@livestore/livestore'

type BackendKey = 'a' | 'b'

type EventPrefix = 'A' | 'B'

const a = makeTodoBackend({ backendId: 'a', eventNamePrefix: 'A' })
const b = makeTodoBackend({ backendId: 'b', eventNamePrefix: 'B' })

export const tables = { a: a.tables, b: b.tables }

export const events = { a: a.events, b: b.events }

export const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [a.backend, b.backend] }),
  events: [...Object.values(a.events), ...Object.values(b.events)],
  devtools: { alias: 'multi-state-todo' },
})

function makeTodoBackend<TBackendId extends BackendKey, TPrefix extends EventPrefix>(args: {
  backendId: TBackendId
  eventNamePrefix: TPrefix
}) {
  const eventNames = {
    todoCreated: `v1.${args.eventNamePrefix}.TodoCreated`,
    todoCompleted: `v1.${args.eventNamePrefix}.TodoCompleted`,
    todoUncompleted: `v1.${args.eventNamePrefix}.TodoUncompleted`,
    todoDeleted: `v1.${args.eventNamePrefix}.TodoDeleted`,
    todoClearedCompleted: `v1.${args.eventNamePrefix}.TodoClearedCompleted`,
  } as const

  const todoTables = {
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

  const todoEvents = {
    todoCreated: Events.synced({
      name: eventNames.todoCreated,
      schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    }),
    todoCompleted: Events.synced({
      name: eventNames.todoCompleted,
      schema: Schema.Struct({ id: Schema.String }),
    }),
    todoUncompleted: Events.synced({
      name: eventNames.todoUncompleted,
      schema: Schema.Struct({ id: Schema.String }),
    }),
    todoDeleted: Events.synced({
      name: eventNames.todoDeleted,
      schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
    }),
    todoClearedCompleted: Events.synced({
      name: eventNames.todoClearedCompleted,
      schema: Schema.Struct({ deletedAt: Schema.Date }),
    }),
  }

  return {
    tables: todoTables,
    events: todoEvents,
    backend: State.SQLite.makeBackend({
      id: args.backendId,
      tables: todoTables,
      materializers: State.SQLite.materializers(todoEvents, {
        [eventNames.todoCreated]: ({ id, text }) => todoTables.todos.insert({ id, text, completed: false }),
        [eventNames.todoCompleted]: ({ id }) => todoTables.todos.update({ completed: true }).where({ id }),
        [eventNames.todoUncompleted]: ({ id }) => todoTables.todos.update({ completed: false }).where({ id }),
        [eventNames.todoDeleted]: ({ id, deletedAt }) => todoTables.todos.update({ deletedAt }).where({ id }),
        [eventNames.todoClearedCompleted]: ({ deletedAt }) =>
          todoTables.todos.update({ deletedAt }).where({ completed: true }),
      }),
    }),
  }
}
