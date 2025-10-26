import { Schema, State } from '@livestore/livestore'

export const UserMetadata = Schema.Struct({
  petName: Schema.String,
  favoriteColor: Schema.Literal('red', 'blue', 'green'),
})

export const userTable = State.SQLite.table({
  name: 'user',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    metadata: State.SQLite.json({ schema: UserMetadata }),
  },
})
