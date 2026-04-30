import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  status: Schema.String.pipe(State.SQLite.withDefault('active')),
  createdAt: Schema.String.pipe(State.SQLite.withDefault('CURRENT_TIMESTAMP')),
  count: Schema.Int.pipe(State.SQLite.withDefault(0)),
})
