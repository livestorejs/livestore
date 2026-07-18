import { Schema, State } from '@livestore/livestore'

const ProductSchema = Schema.Struct({
  id: Schema.Int.pipe(State.SQLite.withPrimaryKey, State.SQLite.withAutoIncrement),
  sku: Schema.String.pipe(State.SQLite.withUnique),
  name: Schema.String,
  price: Schema.Finite.pipe(State.SQLite.withDefault(0)),
  category: Schema.Literals(['electronics', 'clothing', 'books']),
  metadata: Schema.optional(
    Schema.Struct({
      weight: Schema.Finite,
      dimensions: Schema.Struct({
        width: Schema.Finite,
        height: Schema.Finite,
        depth: Schema.Finite,
      }),
    }),
  ),
  isActive: Schema.Boolean.pipe(State.SQLite.withDefault(true)),
  createdAt: Schema.Date.pipe(State.SQLite.withDefault('CURRENT_TIMESTAMP')),
}).annotate({ title: 'products' })

export const productTable = State.SQLite.table({ schema: ProductSchema })
