import { DbSchema, makeSchema } from '@livestore/livestore'

const data = DbSchema.table(
  'data',
  {
    id: DbSchema.integer({ primaryKey: true }),
    label: DbSchema.text({ nullable: false }),
  },
  { deriveMutations: true },
)

const app = DbSchema.table(
  'app',
  {
    selected: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: { clientOnly: true } },
)

export type Row = DbSchema.FromTable.RowDecoded<typeof data>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export type Data = Row[]

export const tables = { data, app }

export const schema = makeSchema({
  tables,
  migrations: { strategy: 'from-mutation-log' },
})
