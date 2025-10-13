import { defineMaterializer, Events, Schema, State } from '@livestore/livestore'

export const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text(),
    completed: State.SQLite.boolean({ default: false }),
    previousIds: State.SQLite.json({
      schema: Schema.Array(Schema.String),
      nullable: true,
    }),
  },
})

export const table1 = State.SQLite.table({
  name: 'settings',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    someVal: State.SQLite.integer({ default: 0 }),
  },
})

export const table2 = State.SQLite.table({
  name: 'preferences',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    otherVal: State.SQLite.text({ default: 'default' }),
  },
})

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean.pipe(Schema.optional),
    }),
  }),
  userPreferencesUpdated: Events.synced({
    name: 'userPreferencesUpdated',
    schema: Schema.Struct({ userId: Schema.String, theme: Schema.String }),
  }),
  factoryResetApplied: Events.synced({
    name: 'factoryResetApplied',
    schema: Schema.Struct({}),
  }),
} as const

export const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text, completed }) =>
    todos.insert({ id, text, completed: completed ?? false }),
  ),
  [events.userPreferencesUpdated.name]: defineMaterializer(events.userPreferencesUpdated, ({ userId, theme }) => {
    console.log(`User ${userId} updated theme to ${theme}.`)
    return []
  }),
  [events.factoryResetApplied.name]: defineMaterializer(events.factoryResetApplied, () => [
    table1.update({ someVal: 0 }),
    table2.update({ otherVal: 'default' }),
  ]),
})
