import { defineMutation, sql } from '@livestore/livestore'
import { Schema } from 'effect'

export const createUser = defineMutation(
  'createUser',
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.Union(Schema.String, Schema.Null),
    photoUrl: Schema.Union(Schema.String, Schema.Null),
  }),
  sql`INSERT INTO users (id, name, email, photoUrl) VALUES ($id, $name, $email, $photoUrl)`,
)

export const deleteUser = defineMutation(
  'deleteUser',
  Schema.Struct({ id: Schema.String }),
  sql`DELETE FROM users WHERE id = $id`,
)
