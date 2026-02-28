import { Events, makeSchema, Schema, State } from '@livestore/livestore'

export const workspaceTables = {
  workspaces: State.SQLite.table({
    name: 'workspaces',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text({ nullable: false }),
      createdAt: State.SQLite.integer({ nullable: false, schema: Schema.DateFromNumber }),
    },
  }),
  issues: State.SQLite.table({
    name: 'issues',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      workspaceId: State.SQLite.text({ nullable: false }),
      createdAt: State.SQLite.integer({ nullable: false, schema: Schema.DateFromNumber }),
    },
  }),
}

export const workspaceEvents = {
  workspaceCreated: Events.synced({
    name: 'v1.WorkspaceCreated',
    schema: Schema.Struct({ id: Schema.String, name: Schema.String, createdAt: Schema.Date }),
  }),
  issueCreated: Events.synced({
    name: 'v1.IssueCreated',
    schema: Schema.Struct({
      id: Schema.String,
      workspaceId: Schema.String,
      title: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
}

const materializers = State.SQLite.materializers(workspaceEvents, {
  'v1.WorkspaceCreated': ({ id, name, createdAt }) => workspaceTables.workspaces.insert({ id, name, createdAt }),
  'v1.IssueCreated': ({ id, workspaceId, createdAt }) => workspaceTables.issues.insert({ id, workspaceId, createdAt }),
})

const state = State.SQLite.makeState({ tables: workspaceTables, materializers })

export const schema = makeSchema({ events: workspaceEvents, state, devtools: { alias: 'workspace' } })
