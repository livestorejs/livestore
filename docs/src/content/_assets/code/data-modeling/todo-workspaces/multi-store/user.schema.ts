import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Emitted when this user creates a new workspace
const workspaceCreated = Events.synced({
  name: 'v1.WorkspaceCreated',
  schema: Schema.Struct({ workspaceId: Schema.String }),
})

// Emitted when this user joins an existing workspace
const workspaceJoined = Events.synced({
  name: 'v1.WorkspaceJoined',
  schema: Schema.Struct({ workspaceId: Schema.String }),
})

const events = { workspaceCreated, workspaceJoined }

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
const userWorkspaceTable = State.SQLite.table({
  name: 'userWorkspace',
  columns: {
    workspaceId: State.SQLite.text({ primaryKey: true }),
    // Could add role/permissions here later
  },
})

export const userTables = { user: userTable, userWorkspace: userWorkspaceTable }

const materializers = State.SQLite.materializers(events, {
  // When the user creates or joins a workspace, add it to their workspace table
  'v1.WorkspaceCreated': ({ workspaceId }) => userTables.userWorkspace.insert({ workspaceId }),
  'v1.WorkspaceJoined': ({ workspaceId }) => userTables.userWorkspace.insert({ workspaceId }),
})

const state = State.SQLite.makeState({ tables: userTables, materializers })

export const schema = makeSchema({ events, state })
