import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  email: Schema.String.pipe(State.SQLite.withUnique),
  username: Schema.String.pipe(State.SQLite.withUnique),
})
