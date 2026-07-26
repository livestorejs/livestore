import { Events, makeSchema, Schema, State } from '@livestore/livestore'

import { Filter } from '../types.ts'
import * as eventsDefs from './events.ts'

/**
 * LiveStore allows you to freely define your app state as SQLite tables (sometimes referred to as "read model")
 * and even supports arbitary schema changes without the need for manual schema migrations.
 *
 * Your app doesn't directly write to those tables, but instead commits events which are then materialized
 * into state (i.e. SQLite tables).
 *
 * LiveStore doesn't sync tables directly, but syncs events instead which are then materialized into the tables
 * resulting in the same state.
 *
 * See docs to learn more: https://docs.livestore.dev/reference/state
 */

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '' }),
    completed: State.SQLite.boolean({ default: false }),
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromMillis }),
  },
})

const uiState = State.SQLite.table({
  name: 'uiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
})

export const events = {
  ...eventsDefs,
  todoDraftChanged: Events.clientOnly({
    name: 'v1.TodoDraftChanged',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoFilterChanged: Events.clientOnly({
    name: 'v1.TodoFilterChanged',
    schema: Schema.Struct({ id: Schema.String, filter: Filter }),
  }),
}

export const tables = { todos, uiState }

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => todos.update({ deletedAt }).where({ completed: true }),
  'v1.TodoDraftChanged': ({ id, text }) =>
    uiState.insert({ id, newTodoText: text, filter: 'all' }).onConflict('id', 'update', { newTodoText: text }),
  'v1.TodoFilterChanged': ({ id, filter }) =>
    uiState.insert({ id, newTodoText: '', filter }).onConflict('id', 'update', { filter }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
