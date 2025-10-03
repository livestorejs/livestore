import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  id: Schema.Int.pipe(State.SQLite.withPrimaryKey).pipe(State.SQLite.withAutoIncrement),
  // Other fields...
})
