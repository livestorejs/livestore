import { Option } from 'effect'

import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Define event payloads
export const events = {
  userCreated: Events.clientOnly({
    name: 'userCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
    }),
  }),
  userUpdated: Events.clientOnly({
    name: 'userUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.OptionFromOptional(Schema.String),
      email: Schema.OptionFromOptional(Schema.String),
      isActive: Schema.OptionFromOptional(Schema.Boolean),
    }),
  }),
  productCreated: Events.clientOnly({
    name: 'productCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
      price: Schema.Finite,
    }),
  }),
  productUpdated: Events.clientOnly({
    name: 'productUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.OptionFromOptional(Schema.String),
      description: Schema.OptionFromOptional(Schema.String),
      price: Schema.OptionFromOptional(Schema.Finite),
    }),
  }),
  todoCreated: Events.clientOnly({
    name: 'todoCreated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }),
  }),
  todoToggled: Events.clientOnly({
    name: 'todoToggled',
    schema: Schema.Struct({
      id: Schema.String,
      completed: Schema.Boolean,
    }),
  }),
  itemCreated: Events.clientOnly({
    name: 'itemCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      metadata: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }),
  itemUpdated: Events.clientOnly({
    name: 'itemUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      status: Schema.String,
    }),
  }),
}

// Define tables
const tables = {
  users: State.SQLite.table({
    name: 'users',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      email: State.SQLite.text(),
      isActive: State.SQLite.boolean(),
      createdAt: State.SQLite.datetime(),
    },
  }),
  products: State.SQLite.table({
    name: 'products',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      description: State.SQLite.text(),
      price: State.SQLite.real(),
      createdAt: State.SQLite.datetime(),
    },
  }),
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean(),
      createdAt: State.SQLite.datetime(),
    },
  }),
}

// Define materializers
const materializers = State.SQLite.materializers(events, {
  userCreated: ({ id, name, email }) => tables.users.insert({ id, name, email, isActive: true, createdAt: new Date() }),
  userUpdated: ({ id, name, email, isActive }) => {
    const updates: { name?: string; email?: string; isActive?: boolean } = {}
    if (Option.isSome(name) === true) updates.name = name.value
    if (Option.isSome(email) === true) updates.email = email.value
    if (Option.isSome(isActive) === true) updates.isActive = isActive.value
    return tables.users.update(updates).where({ id })
  },
  todoCreated: ({ id, text, completed }) => tables.todos.insert({ id, text, completed, createdAt: new Date() }),
  todoToggled: ({ id, completed }) => tables.todos.update({ completed }).where({ id }),
  productCreated: ({ id, name, description, price }) =>
    tables.products.insert({ id, name, description, price, createdAt: new Date() }),
  productUpdated: ({ id, name, description, price }) => {
    const updates: { name?: string; description?: string; price?: number } = {}
    if (Option.isSome(name) === true) updates.name = name.value
    if (Option.isSome(description) === true) updates.description = description.value
    if (Option.isSome(price) === true) updates.price = price.value
    return tables.products.update(updates).where({ id })
  },
  itemCreated: () => [], // Item events don't have a corresponding table
  itemUpdated: () => [], // Item events don't have a corresponding table
})

// Create state
const state = State.SQLite.makeState({ tables, materializers })

// Create the store schema
export const schema = makeSchema({ events, state })

export { tables }
