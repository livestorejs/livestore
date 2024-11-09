import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull().unique('my-unique-index'),
  metaInfo: text('metaInfo').notNull(),
  isCool: integer('isCool', { mode: 'boolean' }).notNull(),
})

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey().notNull(),
  text: text('text').notNull(),
  isCool: integer('isCool', { mode: 'boolean' }).notNull(),
}, (t) => ({
  unique: unique('weird valid name').on(t.text, t.isCool),
}))
