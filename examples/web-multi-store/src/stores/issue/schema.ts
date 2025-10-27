import { Events, makeSchema, Schema, State } from '@livestore/livestore'

export const issueTables = {
  issue: State.SQLite.table({
    name: 'issue',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      workspaceId: State.SQLite.text({ nullable: false }),
      parentIssueId: State.SQLite.text({ nullable: true }),
      title: State.SQLite.text({ nullable: false }),
      status: State.SQLite.text({ default: 'todo' }),
      createdAt: State.SQLite.integer({ nullable: false, schema: Schema.DateFromNumber }),
      childIssueIds: State.SQLite.json({ schema: Schema.Array(Schema.String), default: [] }),
    },
  }),
}

export const issueEvents = {
  issueCreated: Events.synced({
    name: 'v1.IssueCreated',
    schema: Schema.Struct({
      id: Schema.String,
      workspaceId: Schema.String,
      title: Schema.String,
      createdAt: Schema.Date,
      parentIssueId: Schema.optional(Schema.String),
      childIssueIds: Schema.optional(Schema.Array(Schema.String)),
    }),
  }),
  issueStatusChanged: Events.synced({
    name: 'v1.IssueStatusChanged',
    schema: Schema.Struct({
      id: Schema.String,
      status: Schema.Literal('todo', 'in-progress', 'done'),
    }),
  }),
}

const materializers = State.SQLite.materializers(issueEvents, {
  'v1.IssueCreated': ({ id, workspaceId, title, createdAt, parentIssueId, childIssueIds }) =>
    issueTables.issue.insert({ id, workspaceId, title, createdAt, parentIssueId, childIssueIds }),
  'v1.IssueStatusChanged': ({ id, status }) => issueTables.issue.update({ status }).where({ id }),
})

const state = State.SQLite.makeState({ tables: issueTables, materializers })

export const schema = makeSchema({ events: issueEvents, state, devtools: { alias: 'issue' } })
