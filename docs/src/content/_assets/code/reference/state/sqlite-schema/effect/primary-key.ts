import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  // Other fields...
})
