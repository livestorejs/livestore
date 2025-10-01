import { State } from '@livestore/livestore'

export const userTable = State.SQLite.table({
  name: 'users',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    email: State.SQLite.text(),
    name: State.SQLite.text(),
    age: State.SQLite.integer({ default: 0 }),
    isActive: State.SQLite.boolean({ default: true }),
    metadata: State.SQLite.json({ nullable: true }),
  },
  indexes: [{ name: 'idx_users_email', columns: ['email'], isUnique: true }],
})
