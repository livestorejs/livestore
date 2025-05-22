import { makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import { Filter } from '../types.js'
import * as eventsDefs from './events.js'

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
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

// LiveStore aims to provide a unified state management solution (for synced and client-only state),
// so to simplify local-only state management, it also offers a client-only document concept
// giving you the convenience of `React.useState` with a derived `.set` event and auto-registered materializer.
const uiState = State.SQLite.clientDocument({
  name: 'uiState',
  schema: Schema.Struct({ newTodoText: Schema.String, filter: Filter }),
  default: {
    // Using the SessionIdSymbol as default id means the UiState will be scoped per client session (i.e. browser tab).
    id: SessionIdSymbol,
    value: { newTodoText: '', filter: 'all' },
  },
})

export const events = {
  ...eventsDefs,
  uiStateSet: uiState.set,
}

export const tables = { todos, uiState }

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => todos.update({ deletedAt }).where({ completed: true }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
