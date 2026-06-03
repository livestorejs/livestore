import { Events, makeSchema, Schema, State } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'

export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  uiState: State.SQLite.table({
    name: 'uiState',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      newTodoText: State.SQLite.text({ default: '' }),
      filter: State.SQLite.text({ schema: Schema.Literal('all', 'active', 'completed'), default: 'all' }),
    },
  }),
}

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
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  todoClearedCompleted: Events.synced({
    name: 'v1.TodoClearedCompleted',
    schema: Schema.Struct({ deletedAt: Schema.Date }),
  }),
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.Struct({
      newTodoText: Schema.String.pipe(Schema.optional),
      filter: Schema.Literal('all', 'active', 'completed').pipe(Schema.optional),
    }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => tables.todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => tables.todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => tables.todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => tables.todos.update({ deletedAt }).where({ completed: true }),
  'v1.UiStateSet': ({ newTodoText, filter }) =>
    tables.uiState
      .insert({ id: 'default', newTodoText: newTodoText ?? '', filter: filter ?? 'all' })
      .onConflict('id', 'update', omitUndefineds({ newTodoText, filter })),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

export type TodoRow = typeof tables.todos.Type
export type UiStateDoc = Pick<typeof tables.uiState.Type, 'newTodoText' | 'filter'>
