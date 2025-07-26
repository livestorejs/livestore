import { makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

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

const uiState = State.SQLite.clientDocument({
  name: 'uiState',
  schema: Schema.Struct({ newTodoText: Schema.String, filter: Filter }),
  default: {
    id: SessionIdSymbol,
    value: { newTodoText: '', filter: 'all' as Filter },
  },
})

export type Todo = State.SQLite.FromTable.RowDecoded<typeof todos>
export type UiState = typeof uiState.default.value

export const tables = { todos, uiState }

export const events = {
  ...eventsDefs,
  uiStateSet: uiState.set,
}

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => todos.update({ deletedAt }).where({ completed: true }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
