import { Events, makeSchema, State } from '@livestore/common/schema'
import { omitUndefineds } from '@livestore/utils'
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

const appConfig = State.SQLite.table({
  name: 'app_config',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    fontSize: State.SQLite.integer({ default: 16 }),
    theme: State.SQLite.text({ schema: Schema.Literal('light', 'dark'), default: 'light' }),
  },
})

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
  appConfigSet: Events.clientOnly({
    name: 'app_configSet',
    schema: Schema.Struct({ id: Schema.String, value: Schema.partial(Config) }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
  todoCompleted: ({ id }) => todos.update({ completed: true }).where({ id }),
  // This materialize is non-pure as `new Date()` is side effecting
  todoDeletedNonPure: ({ id }) => todos.update({ deletedAt: new Date() }).where({ id }),
  app_configSet: ({ id, value }) =>
    appConfig
      .insert({ id, fontSize: value.fontSize ?? 16, theme: value.theme ?? 'light' })
      .onConflict('id', 'update', omitUndefineds(value)),
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ state, events })
