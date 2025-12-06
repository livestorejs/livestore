import { makeSchema, State } from '@livestore/livestore'

const events = {}

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
}

const state = State.SQLite.makeState({ tables, materializers: {} })

export const schema = makeSchema({ events, state })

export { tables }
