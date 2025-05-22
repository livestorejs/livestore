import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todo = State.SQLite.table({
  name: 'todo',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text(),
  },
})

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, title }) => todo.insert({ id, title }),
})

export const tables = { todo }
const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ state, events })
