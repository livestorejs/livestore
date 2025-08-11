import { queryDb, Schema, sql } from '@livestore/livestore'

// Define your schemas
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  isActive: Schema.Boolean,
})

const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.DateTimeUtc,
})

// Import dependencies (will be available in user's project)
// @ts-ignore
import { atom } from '@effect-atom/atom'
// @ts-ignore
import { StoreTag, schema } from './atoms.ts'

const { tables } = schema

// Create a search term atom
const searchTermAtom = atom<string>('')

// Simple query atom
export const usersAtom = StoreTag.makeQuery(queryDb(tables.users.all()))

// Query with SQL
export const activeUsersAtom = StoreTag.makeQuery(
  queryDb({
    query: sql`SELECT * FROM users WHERE isActive = true ORDER BY name`,
    schema: User.array,
  }),
)

// Dynamic query based on other state
export const searchResultsAtom = StoreTag.makeQuery(
  queryDb(
    (get) => {
      const searchTerm = get(searchTermAtom)

      if (searchTerm.trim() === '') {
        return {
          query: sql`SELECT * FROM products ORDER BY createdAt DESC`,
          schema: Product.array,
        }
      }

      return {
        query: sql`SELECT * FROM products WHERE name LIKE ? ORDER BY name`,
        schema: Product.array,
        bindValues: [`%${searchTerm}%`],
      }
    },
    { label: 'searchResults' },
  ),
)
