import { Events, makeSchema, Schema, State } from '@livestore/livestore'

import * as eventsDefs from './events.ts'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '' }),
    completed: State.SQLite.boolean({ default: false }),
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type

const uiState = State.SQLite.table({
  name: 'uiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
})

export type Todo = State.SQLite.FromTable.RowDecoded<typeof todos>
export type UiState = Pick<State.SQLite.FromTable.RowDecoded<typeof uiState>, 'newTodoText' | 'filter'>

export const tables = { todos, uiState }

export const events = {
  ...eventsDefs,
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.Struct({
      newTodoText: Schema.String.pipe(Schema.optional),
      filter: Filter.pipe(Schema.optional),
    }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => todos.update({ deletedAt }).where({ completed: true }),
  'v1.UiStateSet': ({ newTodoText, filter }) =>
    uiState
      .insert({ id: 'default', newTodoText: newTodoText ?? '', filter: filter ?? 'all' })
      .onConflict('id', 'update', {
        ...(newTodoText === undefined ? {} : { newTodoText }),
        ...(filter === undefined ? {} : { filter }),
      }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Shared sync payload schema for this example
export const SyncPayload = Schema.Struct({ authToken: Schema.String })
