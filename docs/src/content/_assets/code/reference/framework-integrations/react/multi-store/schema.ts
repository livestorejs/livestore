import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Event definitions
export const events = {
  issueCreated: Events.synced({
    name: 'v1.IssueCreated',
    schema: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      status: Schema.Literal('todo', 'done'),
    }),
  }),
  issueStatusChanged: Events.synced({
    name: 'v1.IssueStatusChanged',
    schema: Schema.Struct({
      id: Schema.String,
      status: Schema.Literal('todo', 'done'),
    }),
  }),
}

// State definition
export const tables = {
  issue: State.SQLite.table({
    name: 'issue',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
      status: State.SQLite.text(),
    },
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.IssueCreated': ({ id, title, status }) => tables.issue.insert({ id, title, status }),
  'v1.IssueStatusChanged': ({ id, status }) => tables.issue.update({ status }).where({ id }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
