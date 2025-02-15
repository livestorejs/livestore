import { DbSchema } from '@livestore/livestore'
import { Schema } from 'effect'

export const description = DbSchema.table(
  'description',
  {
    // TODO: id is also a foreign key to issue
    id: DbSchema.integer({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    deleted: DbSchema.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
  { deriveMutations: true },
)
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
