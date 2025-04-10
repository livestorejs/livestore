import { DbSchema, makeSchema, State } from '@livestore/common/schema'

export * as Bridge from './bridge.js'

const todos = DbSchema.table({
  name: 'todos',
  columns: {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
})

const state = State.SQLite.makeState({ tables: { todos }, materializers: {} })

export const schema = makeSchema({ state, events: {} })
