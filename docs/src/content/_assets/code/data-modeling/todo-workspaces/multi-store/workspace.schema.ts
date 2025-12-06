import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Emitted when a new workspace is created (originates this store)
const workspaceCreated = Events.synced({
  name: 'v1.WorkspaceCreated',
  schema: Schema.Struct({
    workspaceId: Schema.String,
    name: Schema.String,
    createdByUsername: Schema.String,
  }),
})

// Emitted when a todo item is added to this workspace
const todoAdded = Events.synced({
  name: 'v1.TodoAdded',
  schema: Schema.Struct({ todoId: Schema.String, text: Schema.String }),
})

// Emitted when a todo item is marked as completed
const todoCompleted = Events.synced({
  name: 'v1.TodoCompleted',
  schema: Schema.Struct({ todoId: Schema.String }),
})

// Emitted when a todo item is deleted (soft delete)
const todoDeleted = Events.synced({
  name: 'v1.TodoDeleted',
  schema: Schema.Struct({ todoId: Schema.String, deletedAt: Schema.Date }),
})

// Emitted when a new user joins this workspace
const userJoined = Events.synced({
  name: 'v1.UserJoined',
  schema: Schema.Struct({ username: Schema.String }),
})

export const workspaceEvents = { workspaceCreated, todoAdded, todoCompleted, todoDeleted, userJoined }

// Table for the workspace itself (only one row as this store is per-workspace)
const workspaceTable = State.SQLite.table({
  name: 'workspace',
  columns: {
    workspaceId: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    createdByUsername: State.SQLite.text(),
  },
})

// Table for the todo items in this workspace
const todoTable = State.SQLite.table({
  name: 'todo',
  columns: {
    todoId: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text(),
    completed: State.SQLite.boolean({ default: false }),
    // Using soft delete by adding a deletedAt timestamp
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

// Table for members of this workspace
const memberTable = State.SQLite.table({
  name: 'member',
  columns: {
    username: State.SQLite.text({ primaryKey: true }),
    // Could add role/permissions here later
  },
})

export const workspaceTables = { workspace: workspaceTable, todo: todoTable, member: memberTable }

const materializers = State.SQLite.materializers(workspaceEvents, {
  'v1.WorkspaceCreated': ({ workspaceId, name, createdByUsername }) => [
    workspaceTables.workspace.insert({ workspaceId, name, createdByUsername }),
    // Add the creator as the first member
    workspaceTables.member.insert({ username: createdByUsername }),
  ],
  'v1.TodoAdded': ({ todoId, text }) => workspaceTables.todo.insert({ todoId, text }),
  'v1.TodoCompleted': ({ todoId }) => workspaceTables.todo.update({ completed: true }).where({ todoId }),
  'v1.TodoDeleted': ({ todoId, deletedAt }) => workspaceTables.todo.update({ deletedAt }).where({ todoId }),
  'v1.UserJoined': ({ username }) => workspaceTables.member.insert({ username }),
})

const state = State.SQLite.makeState({ tables: workspaceTables, materializers })

export const schema = makeSchema({ events: workspaceEvents, state })
