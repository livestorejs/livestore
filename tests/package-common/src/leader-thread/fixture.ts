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

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  todoDeletedNonPure: Events.synced({
    name: 'todoDeletedNonPure',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  // Events for testing GitHub issue #409
  noopEvent: Events.synced({
    name: 'noopEvent',
    schema: Schema.Struct({ id: Schema.String, data: Schema.String }),
  }),
  crashingEvent: Events.synced({
    name: 'crashingEvent',
    schema: Schema.Struct({ id: Schema.String, data: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
  // This materialize is non-pure as `new Date()` is side effecting
  todoDeletedNonPure: ({ id }) => todos.update({ deletedAt: new Date() }).where({ id }),
  // Materializers for testing GitHub issue #409
  noopEvent: () => [], // Returns noop - no state changes
  crashingEvent: () => {
    throw new Error('Materialization crash for testing issue #409')
  },
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ state, events })
