import type { Schema } from '@livestore/livestore'
import { sql } from '@livestore/livestore'
import { z } from 'zod'

export const Todo = z.object({
  id: z.string(),
  text: z.string().nullable().default(''),
  completed: z.boolean().default(false),
})

export type Todo = z.infer<typeof Todo>

export type Filter = 'all' | 'active' | 'completed'

export type AppState = {
  newTodoText: string
  filter: Filter
}

const defineSchema_ = <S extends Schema>(schema: S) => schema

// TODO: auto-generate schema from Zod type objects
export const schema = defineSchema_({
  tables: {
    todos: {
      columns: {
        id: { type: 'text', primaryKey: true },
        text: { type: 'text', default: '', nullable: false },
        completed: { type: 'boolean', default: false, nullable: false },
      },
    },
    app: {
      columns: {
        id: { type: 'text', primaryKey: true },
        newTodoText: { type: 'text', default: '', nullable: true },
        filter: { type: 'text', default: 'all', nullable: false },
      },
    },
  },
  materializedViews: {},
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
