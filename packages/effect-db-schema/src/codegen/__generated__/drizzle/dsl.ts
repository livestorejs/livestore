import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  metaInfo: text('metaInfo'),
  isCool: integer('isCool', { mode: 'boolean' }),
  createdAt: integer('createdAt', { mode: 'timestamp' }).default(
    new Date('2023-10-01T13:54:43.861Z'),
  ),
})
