import { DbSchema, Schema } from '@livestore/livestore'

export const description = DbSchema.table(
  'description',
  {
    // TODO: id is also a foreign key to issue
    id: DbSchema.integer({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    deleted: DbSchema.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
  { deriveEvents: true },
)
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
