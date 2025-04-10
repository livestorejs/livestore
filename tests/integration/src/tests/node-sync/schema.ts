import { DbSchema, Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todo = DbSchema.table({
  name: 'todo',
  columns: {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text(),
  },
})

export const events = {
  todoCreated: Events.global({
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
