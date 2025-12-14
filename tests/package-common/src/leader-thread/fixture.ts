import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    deletedAt: State.SQLite.datetime({ default: null, nullable: true }),
  },
})

const Config = Schema.Struct({
  fontSize: Schema.Number,
  theme: Schema.Literal('light', 'dark'),
})

const appConfig = State.SQLite.clientDocument({
  name: 'app_config',
  schema: Config,
  default: { value: { fontSize: 16, theme: 'light' } },
})

const appConfigTable = appConfig as typeof appConfig & State.SQLite.ClientDocumentTableDef<any, any, any, any>

export const appConfigSetEvent = appConfigTable[State.SQLite.ClientDocumentTableDefSymbol].derived.setEventDef

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  todoCompleted: Events.synced({
    name: 'todoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeletedNonPure: Events.synced({
    name: 'todoDeletedNonPure',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
  todoCompleted: ({ id }) => todos.update({ completed: true }).where({ id }),
  // This materialize is non-pure as `new Date()` is side effecting
  todoDeletedNonPure: ({ id }) => todos.update({ deletedAt: new Date() }).where({ id }),
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ state, events })
