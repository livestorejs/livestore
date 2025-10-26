import { Schema, State } from '@livestore/livestore'
import { Priority } from '../../types/priority.ts'
import { Status } from '../../types/status.ts'

export const issue = State.SQLite.table({
  name: 'issue',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    title: State.SQLite.text({ default: '' }),
    creator: State.SQLite.text({ default: '' }),
    priority: State.SQLite.integer({ schema: Priority, default: 0 }),
    status: State.SQLite.integer({ schema: Status, default: 0 }),
    created: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    modified: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    kanbanorder: State.SQLite.text({ nullable: false, default: '' }),
  },
  indexes: [
    { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
    { name: 'issue_created', columns: ['created'] },
  ],
  deriveEvents: true,
})

export type Issue = typeof issue.Type
