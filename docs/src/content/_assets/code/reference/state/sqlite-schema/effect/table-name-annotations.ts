import { Schema, State } from '@livestore/livestore'

// Using title annotation
const UserSchema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  name: Schema.String,
}).annotations({ title: 'users' })

export const userTable = State.SQLite.table({ schema: UserSchema })

// Using identifier annotation
const PostSchema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  title: Schema.String,
}).annotations({ identifier: 'posts' })

export const postTable = State.SQLite.table({ schema: PostSchema })
