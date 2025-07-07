import { Events, makeSchema, Schema, State } from '@livestore/livestore'

const events = {
  NodeCreated: Events.synced({
    name: 'NodeCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const tables = {
  notes: State.SQLite.table({
    name: 'notes',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
      completed: State.SQLite.integer({ default: 0 }),
    },
  }),
}

const materializers: State.SQLite.Materializers<typeof events> = {
  NodeCreated: ({ id, title }) => tables.notes.insert({ id, title }),
}

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state, devtools: { alias: 'schema-notes' } })
