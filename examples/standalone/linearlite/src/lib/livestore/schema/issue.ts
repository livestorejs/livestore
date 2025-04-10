import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { DbSchema, Schema } from '@livestore/livestore'
export const issue = DbSchema.table(
  'issue',
  {
    id: DbSchema.integer({ primaryKey: true }),
    title: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    priority: DbSchema.integer({ schema: Priority, default: 0 }),
    status: DbSchema.integer({ schema: Status, default: 0 }),
    created: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    deleted: DbSchema.integer({ nullable: true, schema: Schema.DateFromNumber }),
    modified: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    kanbanorder: DbSchema.text({ nullable: false, default: '' }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
    deriveEvents: true,
  },
)
export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
