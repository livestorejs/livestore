import { Atom } from '@effect-atom/atom'
import { queryDb, sql } from '@livestore/livestore'
import { Schema } from 'effect'
import { StoreTag } from './atoms.ts'

// User schema for type safety
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  isActive: Schema.Boolean,
})

const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.DateTimeUtc,
})

// Search term atom for dynamic queries
export const searchTermAtom = Atom.make<string>('')

// Re-export from utils for convenience
export { usersQueryAtom as usersAtom } from './utils.ts'

// Query with SQL
export const activeUsersAtom = StoreTag.makeQuery(
  queryDb({
    query: sql`SELECT * FROM users WHERE isActive = true ORDER BY name`,
    schema: Schema.Array(User),
  }),
)

// Static query example - dynamic queries would need a different approach
// For dynamic queries, you'd typically use a derived atom that depends on searchTermAtom
export const searchResultsAtom = StoreTag.makeQuery(
  queryDb({
    query: sql`SELECT * FROM products ORDER BY createdAt DESC`,
    schema: Schema.Array(Product),
  }),
)
