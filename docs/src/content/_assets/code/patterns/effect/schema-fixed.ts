import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Define event payloads
const events = {
  userCreated: Events.local(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      isActive: Schema.Boolean,
    }),
  ),
  userUpdated: Events.local(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalWith(Schema.String, { as: 'Option' }),
      email: Schema.optionalWith(Schema.String, { as: 'Option' }),
      isActive: Schema.optionalWith(Schema.Boolean, { as: 'Option' }),
    }),
  ),
  productCreated: Events.local(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
      price: Schema.Number,
    }),
  ),
  productUpdated: Events.local(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalWith(Schema.String, { as: 'Option' }),
      description: Schema.optionalWith(Schema.String, { as: 'Option' }),
      price: Schema.optionalWith(Schema.Number, { as: 'Option' }),
    }),
  ),
  todoCreated: Events.local(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }),
  ),
  todoToggled: Events.local(
    Schema.Struct({
      id: Schema.String,
      completed: Schema.Boolean,
    }),
  ),
  itemCreated: Events.local(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    }),
  ),
  itemUpdated: Events.local(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
    }),
  ),
}

// Define tables
const state = {
  users: State.SQLite.table({
    name: 'users',
    columns: {
      id: State.SQLite.text().primaryKey(),
      name: State.SQLite.text(),
      email: State.SQLite.text(),
      isActive: State.SQLite.boolean,
      createdAt: State.SQLite.datetime(),
    },
  }),
  products: State.SQLite.table({
    name: 'products',
    columns: {
      id: State.SQLite.text().primaryKey(),
      name: State.SQLite.text(),
      description: State.SQLite.text(),
      price: State.SQLite.real(),
      createdAt: State.SQLite.datetime(),
    },
  }),
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text().primaryKey(),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean,
      createdAt: State.SQLite.datetime(),
    },
  }),
}

// Create the store schema
export const schema = makeSchema({ events, state })

export const { tables } = schema
