import { Schema, State } from '@livestore/livestore'

const ProductSchema = Schema.Struct({
  id: Schema.Int.pipe(State.SQLite.withPrimaryKey, State.SQLite.withAutoIncrement),
  sku: Schema.String.pipe(State.SQLite.withUnique),
  name: Schema.String,
  price: Schema.Number.pipe(State.SQLite.withDefault(0)),
  category: Schema.Literal('electronics', 'clothing', 'books'),
  metadata: Schema.optional(
    Schema.Struct({
      weight: Schema.Number,
      dimensions: Schema.Struct({
        width: Schema.Number,
        height: Schema.Number,
        depth: Schema.Number,
      }),
    }),
  ),
  isActive: Schema.Boolean.pipe(State.SQLite.withDefault(true)),
  createdAt: Schema.Date.pipe(State.SQLite.withDefault('CURRENT_TIMESTAMP')),
}).annotations({ title: 'products' })

export const productTable = State.SQLite.table({ schema: ProductSchema })
