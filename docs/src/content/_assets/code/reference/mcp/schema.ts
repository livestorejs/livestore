import { Events, makeSchema, Schema, State } from '@livestore/livestore'

const events = {
  entityCreated: Events.synced({
    name: 'v1.EntityCreated',
    schema: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      createdAt: Schema.DateFromString,
    }),
  }),
}

const tables = {
  entities: State.SQLite.table({
    name: 'entities',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text({ default: '' }),
      createdAt: State.SQLite.text({ default: '' }),
    },
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.EntityCreated': ({ id, title, createdAt }) =>
    tables.entities.insert({ id, title, createdAt: createdAt.toISOString() }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
