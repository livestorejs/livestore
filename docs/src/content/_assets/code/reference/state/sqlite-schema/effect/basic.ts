import { Schema, State } from '@livestore/livestore'

const UserSchema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  email: Schema.String.pipe(State.SQLite.withUnique),
  name: Schema.String,
  age: Schema.Int.pipe(State.SQLite.withDefault(0)),
  isActive: Schema.Boolean.pipe(State.SQLite.withDefault(true)),
  metadata: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
}).annotations({ title: 'users' })

export const userTable = State.SQLite.table({ schema: UserSchema })
