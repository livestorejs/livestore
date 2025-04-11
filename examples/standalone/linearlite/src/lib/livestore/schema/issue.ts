import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { State, Schema } from '@livestore/livestore'
export const issue = State.SQLite.table(
  'issue',
  {
    id: State.SQLite.integer({ primaryKey: true }),
    title: State.SQLite.text({ default: '' }),
    creator: State.SQLite.text({ default: '' }),
    priority: State.SQLite.integer({ schema: Priority, default: 0 }),
    status: State.SQLite.integer({ schema: Status, default: 0 }),
    created: State.SQLite.integer({ default: { sql: `(strftime('%s','now'))` } }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    modified: State.SQLite.integer({ default: { sql: `(strftime('%s','now'))` } }),
    kanbanorder: State.SQLite.text({ nullable: false, default: '' }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
    deriveEvents: true,
  },
)
export type Issue = State.SQLite.FromTable.RowDecoded<typeof issue>
