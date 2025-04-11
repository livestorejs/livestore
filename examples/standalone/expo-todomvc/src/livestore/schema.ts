import { makeSchema, Schema, State } from '@livestore/livestore'

import { Filter } from '../types.ts'
import * as mutations from './mutations.ts'

const todos = State.SQLite.table(
  'todos',
  {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '' }),
    completed: State.SQLite.boolean({ default: false }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
  { deriveEvents: true },
)

const app = State.SQLite.table(
  'app',
  {
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
  { isSingleton: true, deriveEvents: true },
)

export type Todo = State.SQLite.FromTable.RowDecoded<typeof todos>
export type AppState = State.SQLite.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

export const schema = makeSchema({ tables, mutations })

export * as mutations from './mutations.ts'
