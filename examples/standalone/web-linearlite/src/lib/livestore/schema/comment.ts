import { State, Schema } from '@livestore/livestore'

export const comment = State.SQLite.table({
  name: 'comment',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    body: State.SQLite.text({ default: '' }),
    creator: State.SQLite.text({ default: '' }),
    issueId: State.SQLite.integer(),
    created: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
  indexes: [{ name: 'issue_id', columns: ['issueId'] }],
})

export type Comment = typeof comment.Type
