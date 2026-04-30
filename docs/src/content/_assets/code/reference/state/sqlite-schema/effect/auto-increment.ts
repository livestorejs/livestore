import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  id: Schema.Int.pipe(State.SQLite.withPrimaryKey, State.SQLite.withAutoIncrement),
  // Other fields...
})
