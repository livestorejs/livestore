import { DbSchema, defineMutation, makeSchema, sql } from '@livestore/livestore'
import { Schema } from 'effect'

const todos = DbSchema.table('todos', {
  id: DbSchema.text({ primaryKey: true }),
  text: DbSchema.text({ default: '' }),
  completed: DbSchema.boolean({ default: false }),
  deleted: DbSchema.integer({ nullable: true }),
})

const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type

const app = DbSchema.table(
  'app',
  {
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.text({ schema: Filter, default: 'all' }),
  },
  { isSingleton: true },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

const addTodo = defineMutation(
  'addTodo',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

const completeTodo = defineMutation(
  'completeTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)

const uncompleteTodo = defineMutation(
  'uncompleteTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
)

export const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE id = $id`,
)

export const clearCompleted = defineMutation(
  'clearCompleted',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE completed = true`,
)

const updateNewTodoText = defineMutation(
  'updateNewTodoText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newTodoText = $text`,
)

const setFilter = defineMutation('setFilter', Schema.Struct({ filter: Filter }), sql`UPDATE app SET filter = $filter`)

export const mutations = {
  addTodo,
  completeTodo,
  uncompleteTodo,
  deleteTodo,
  clearCompleted,
  updateNewTodoText,
  setFilter,
}

export const schema = makeSchema({ tables, mutations })
