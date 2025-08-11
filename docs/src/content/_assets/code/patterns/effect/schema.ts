import { makeSchema } from '@livestore/livestore'
import { Schema } from 'effect'

// Define schemas for your domain
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  isActive: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
})

const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  price: Schema.Number,
  createdAt: Schema.DateTimeUtc,
})

const Todo = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
})

// Create the store schema
export const schema = makeSchema({
  events: {
    userCreated: User,
    userUpdated: Schema.Struct({
      id: Schema.String,
      name: Schema.optionalWith(Schema.String, { as: 'Option' }),
      email: Schema.optionalWith(Schema.String, { as: 'Option' }),
      isActive: Schema.optionalWith(Schema.Boolean, { as: 'Option' }),
    }),
    productCreated: Product,
    productUpdated: Schema.Struct({
      id: Schema.String,
      name: Schema.optionalWith(Schema.String, { as: 'Option' }),
      description: Schema.optionalWith(Schema.String, { as: 'Option' }),
      price: Schema.optionalWith(Schema.Number, { as: 'Option' }),
    }),
    todoCreated: Todo,
    todoToggled: Schema.Struct({
      id: Schema.String,
      completed: Schema.Boolean,
    }),
    itemCreated: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    }),
    itemUpdated: Schema.Struct({
      id: Schema.String,
      status: Schema.String,
    }),
  },
  tables: {
    users: User,
    products: Product,
    todos: Todo,
  },
})

export const { events, tables } = schema
