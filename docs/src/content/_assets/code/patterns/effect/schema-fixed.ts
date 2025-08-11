import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Define event payloads
const events = {
  userCreated: Events.clientOnly({
    name: 'userCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      isActive: Schema.Boolean,
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
  userCreated: ({ id, name, email, isActive }) =>
    tables.users.insert({ id, name, email, isActive, createdAt: new Date() }),
  todoCreated: ({ id, text, completed }) =>
    tables.todos.insert({ id, text, completed, createdAt: new Date() }),
  todoToggled: ({ id, completed }) =>
    tables.todos.update({ completed }).where({ id }),
})

// Create state
const state = State.SQLite.makeState({ tables, materializers })

// Create the store schema
export const schema = makeSchema({ events, state })

export { tables, events }