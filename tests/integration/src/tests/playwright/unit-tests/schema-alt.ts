import { makeSchema, State } from '@livestore/common/schema'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    newCol: State.SQLite.integer({ default: 0, nullable: true }),
  },
})

const state = State.SQLite.makeState({ tables: { todos }, materializers: {} })

export const schema = makeSchema({ state, events: {} })
