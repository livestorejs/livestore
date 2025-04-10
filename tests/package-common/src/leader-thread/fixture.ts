import { DbSchema, Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todos = DbSchema.table({
  name: 'todos',
  columns: {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
})

const Config = Schema.Struct({
  fontSize: Schema.Number,
  theme: Schema.Literal('light', 'dark'),
})

const appConfig = DbSchema.clientDocument({
  name: 'app_config',
  schema: Config,
  default: { value: { fontSize: 16, theme: 'light' } },
})

export const events = {
  todoCreated: Events.global({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ state, events })
