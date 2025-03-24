import { DbSchema, Schema } from '@livestore/livestore'
export const comment = DbSchema.table(
  'comment',
  {
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    issueId: DbSchema.integer(),
    created: DbSchema.integer(),
    deleted: DbSchema.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
  {
    indexes: [{ name: 'issue_id', columns: ['issueId'] }],
  },
)
export type Comment = DbSchema.FromTable.RowDecoded<typeof comment>
