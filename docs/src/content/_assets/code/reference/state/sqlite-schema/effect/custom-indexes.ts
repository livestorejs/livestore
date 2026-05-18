import { Schema, State } from '@livestore/livestore'

const PostSchema = Schema.Struct({
  id: Schema.String.pipe(State.SQLite.withPrimaryKey),
  title: Schema.String,
  authorId: Schema.String,
  createdAt: Schema.Date,
}).annotations({ title: 'posts' })

export const postTable = State.SQLite.table({
  schema: PostSchema,
  indexes: [
    { name: 'idx_posts_author', columns: ['authorId'] },
    { name: 'idx_posts_created', columns: ['createdAt'] },
  ],
})
