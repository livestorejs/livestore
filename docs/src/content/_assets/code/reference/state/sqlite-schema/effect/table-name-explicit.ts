import { Schema, State } from '@livestore/livestore'

const UserSchema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  name: Schema.String,
})

export const userTable = State.SQLite.table({
  name: 'users',
  schema: UserSchema,
})
