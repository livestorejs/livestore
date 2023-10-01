import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
})

export type SelectTodos = InferSelectModel<typeof todos>
export type InsertTodos = InferInsertModel<typeof todos>

export const app = sqliteTable('app', {
  id: text('id').primaryKey(),
  newTodoText: text('newTodoText').notNull().default(''),
  filter: text('filter').notNull().default('all'),
})

export type SelectApp = InferSelectModel<typeof app>
export type InsertApp = InferInsertModel<typeof app>

export type TableName = typeof todos._.name | typeof app._.name
