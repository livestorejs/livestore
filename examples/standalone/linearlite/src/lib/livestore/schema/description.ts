import { DbSchema } from '@livestore/livestore'

export const description = DbSchema.table(
  'description',
  {
    // TODO: id is also a foreign key to issue
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    deleted: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: true },
)
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
