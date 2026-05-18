import { Schema, State } from '@livestore/livestore'

class User extends Schema.Class<User>('User')({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  email: Schema.String.pipe(State.SQLite.withUnique),
  name: Schema.String,
  age: Schema.Int,
}) {}

export const userTable = State.SQLite.table({
  name: 'users',
  schema: User,
})
