import { Schema } from '@effect/schema'
import { DbSchema, defineMutation, makeSchema, sql } from '@livestore/livestore'

const todos = DbSchema.table('todos', {
  id: DbSchema.text({ primaryKey: true }),
  text: DbSchema.text({ default: '' }),
  completed: DbSchema.boolean({ default: false }),
})

const Filter = Schema.Literal('all', 'active', 'completed')

const app = DbSchema.table(
  'app',
  {
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.text({ schema: Filter, default: 'all' }),
  },
  { isSingleton: true },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>
export type Filter = Schema.Schema.Type<typeof Filter>
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

const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.Struct({ id: Schema.String }),
  sql`DELETE FROM todos WHERE id = $id`,
)

const clearCompleted = defineMutation('clearCompleted', Schema.Void, sql`DELETE FROM todos WHERE completed = true`)

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
