import { Atom } from '@effect-atom/atom'
import { queryDb, sql } from '@livestore/livestore'
import { Schema } from 'effect'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

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

// Assume we have a search term atom
const searchTermAtom = Atom.make<string>('')

// Simple query atom
export const usersAtom = StoreTag.makeQuery(queryDb(tables.users))

// Query with SQL
export const activeUsersAtom = StoreTag.makeQuery(
  queryDb({
    query: sql`SELECT * FROM users WHERE isActive = true ORDER BY name`,
    schema: Schema.Array(User),
  }),
)

// Dynamic query based on other state
export const searchResultsAtom = StoreTag.makeQuery(
  queryDb(
    (get) => {
      const searchTerm = get(searchTermAtom as any) as string

      if (searchTerm.trim() === '') {
        return {
          query: sql`SELECT * FROM products ORDER BY createdAt DESC`,
          schema: Schema.Array(Product),
        }
      }

      return {
        query: sql`SELECT * FROM products WHERE name LIKE ? ORDER BY name`,
        schema: Schema.Array(Product),
        bindValues: [`%${searchTerm}%`],
      }
    },
    { label: 'searchResults' },
  ),
)
