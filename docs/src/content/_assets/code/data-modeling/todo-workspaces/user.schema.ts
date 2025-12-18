import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Emitted when this user creates a new workspace
const workspaceCreated = Events.synced({
  name: 'v1.WorkspaceCreated',
  schema: Schema.Struct({ workspaceId: Schema.String, name: Schema.String }),
})

// Emitted when this user joins an existing workspace
const workspaceJoined = Events.synced({
  name: 'v1.WorkspaceJoined',
  schema: Schema.Struct({ workspaceId: Schema.String, name: Schema.String }),
})

export const userEvents = { workspaceCreated, workspaceJoined }

// Table to store basic user info
// Contains only one row as this store is per-user.
const userTable = State.SQLite.table({
  name: 'user',
  columns: {
    // Assuming username is unique and used as the identifier
    username: State.SQLite.text({ primaryKey: true }),
  },
})

// Table to track which workspaces this user is part of
const userWorkspacesTable = State.SQLite.table({
  name: 'userWorkspaces',
  columns: {
    workspaceId: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    // Could add role/permissions here later
  },
})

export const userTables = { user: userTable, userWorkspaces: userWorkspacesTable }

const materializers = State.SQLite.materializers(userEvents, {
  // When the user creates or joins a workspace, add it to their workspace table
  'v1.WorkspaceCreated': ({ workspaceId, name }) => userTables.userWorkspaces.insert({ workspaceId, name }),
  'v1.WorkspaceJoined': ({ workspaceId, name }) => userTables.userWorkspaces.insert({ workspaceId, name }),
})

const state = State.SQLite.makeState({ tables: userTables, materializers })

export const schema = makeSchema({ events: userEvents, state })
