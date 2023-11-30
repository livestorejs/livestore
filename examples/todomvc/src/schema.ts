import { Schema } from '@effect/schema'
import { DbSchema, makeSchema, sql } from '@livestore/livestore'

const todos = DbSchema.table('todos', {
  id: DbSchema.text({ primaryKey: true }),
  text: DbSchema.text({ default: '' }),
  completed: DbSchema.boolean({ default: false }),
})

const Filter = Schema.literal('all', 'active', 'completed')

const app = DbSchema.table(
  'app',
  {
    id: DbSchema.textWithSchema(Schema.literal('static'), { primaryKey: true }),
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.textWithSchema(Filter, { default: 'all' }),
  },
  { isSingleton: true },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>
export type Filter = Schema.Schema.To<typeof Filter>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export const schema = makeSchema({
  tables: { todos, app },
  actions: {
    // TODO: fix these actions to make them have write annotatinos
    addTodo: {
      statement: {
        sql: sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false);`,
        writeTables: ['todos'],
      },
    },
    completeTodo: {
      statement: { sql: sql`UPDATE todos SET completed = true WHERE id = $id;`, writeTables: ['todos'] },
    },
    uncompleteTodo: {
      statement: { sql: sql`UPDATE todos SET completed = false WHERE id = $id;`, writeTables: ['todos'] },
    },
    deleteTodo: { statement: { sql: sql`DELETE FROM todos WHERE id = $id;`, writeTables: ['todos'] } },
    clearCompleted: { statement: { sql: sql`DELETE FROM todos WHERE completed = true;`, writeTables: ['todos'] } },
    updateNewTodoText: { statement: { sql: sql`UPDATE app SET newTodoText = $text;`, writeTables: ['app'] } },
    setFilter: { statement: { sql: sql`UPDATE app SET filter = $filter;`, writeTables: ['app'] } },
  },
})
