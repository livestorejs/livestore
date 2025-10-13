import { State } from '@livestore/livestore'

export const reaction = State.SQLite.table({
  name: 'reaction',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text(),
    commentId: State.SQLite.text(),
    userId: State.SQLite.text(),
    emoji: State.SQLite.text(),
  },
  indexes: [
    { name: 'comment_id', columns: ['commentId'] },
    { name: 'issue_id', columns: ['issueId'] },
  ],
})

export type Reaction = typeof reaction.Type
