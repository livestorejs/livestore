import { defineMutation, makeSchema, Schema, sql, State } from '@livestore/livestore'

const todos = State.SQLite.table('todos', {
  id: State.SQLite.text({ primaryKey: true }),
  text: State.SQLite.text({ default: '' }),
  completed: State.SQLite.boolean({ default: false }),
  deleted: State.SQLite.integer({ nullable: true }),
})

const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type

const app = State.SQLite.table(
  'app',
  {
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
  { isSingleton: true },
)

export type Todo = State.SQLite.FromTable.RowDecoded<typeof todos>
export type AppState = State.SQLite.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

const todoCreated = defineMutation(
  'todoCreated',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

const todoCompleted = defineMutation(
  'todoCompleted',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)

const todoUncompleted = defineMutation(
  'todoUncompleted',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
)

export const todoDeleted = defineMutation(
  'todoDeleted',
  Schema.Struct({ id: Schema.String, deleted: Schema.DateFromNumber }),
  sql`UPDATE todos SET deleted = $deleted WHERE id = $id`,
)

export const todoClearedCompleted = defineMutation(
  'todoClearedCompleted',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE completed = true`,
)

const updatedNewTodoText = defineMutation(
  'updatedNewTodoText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newTodoText = $text`,
)

const setFilter = defineMutation('setFilter', Schema.Struct({ filter: Filter }), sql`UPDATE app SET filter = $filter`)

export const mutations = {
  todoCreated,
  todoCompleted,
  todoUncompleted,
  todoDeleted,
  todoClearedCompleted,
  updatedNewTodoText,
  setFilter,
}

export const schema = makeSchema({ tables, mutations })
