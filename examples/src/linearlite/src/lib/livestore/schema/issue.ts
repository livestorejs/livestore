import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { DbSchema } from '@livestore/livestore'

export const issue = DbSchema.table(
  'issue',
  {
    id: DbSchema.integer({ primaryKey: true }),
    title: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    priority: DbSchema.integer({ schema: Priority, default: 0 }),
    status: DbSchema.text({ schema: Status, default: 'todo' }),
    created: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    deleted: DbSchema.integer({ nullable: true }),
    modified: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    kanbanorder: DbSchema.text({ nullable: false, default: '' }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
    deriveMutations: true,
  },
)
export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
