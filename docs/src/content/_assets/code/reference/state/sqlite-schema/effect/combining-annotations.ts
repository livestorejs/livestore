import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  id: Schema.Int.pipe(State.SQLite.withPrimaryKey).pipe(State.SQLite.withAutoIncrement),
  email: Schema.String.pipe(State.SQLite.withUnique).pipe(State.SQLite.withColumnType('text')),
})
