import { makeSchema, State } from '@livestore/common/schema'

export * as Bridge from './bridge.ts'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
  },
})

const state = State.SQLite.makeState({ tables: { todos }, materializers: {} })

export const schema = makeSchema({ state, events: {} })
