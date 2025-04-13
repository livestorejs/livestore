import { State, Schema } from '@livestore/livestore'

export const description = State.SQLite.table({
  name: 'description',
  columns: {
    // TODO: id is also a foreign key to issue
    id: State.SQLite.integer({ primaryKey: true }),
    body: State.SQLite.text({ default: '' }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

export type Description = typeof description.Type
