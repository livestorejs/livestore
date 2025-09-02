import { makeSchema, State } from '@livestore/common/schema'

// This schema is the same as the main schema but with an added column to trigger a schema migration

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    newCol: State.SQLite.integer({ default: 0, nullable: true }), // New column added to trigger migration
  },
})

const state = State.SQLite.makeState({ tables: { todos }, materializers: {} })

export const schema = makeSchema({ state, events: {} })
