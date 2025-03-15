import { DbSchema, makeSchema } from '@livestore/livestore'

const items = DbSchema.table(
  'items',
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

export type Item = DbSchema.FromTable.RowDecoded<typeof items>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export type Items = Item[]

export const tables = { items, app }

export const schema = makeSchema({
  tables,
  migrations: { strategy: 'from-mutation-log' },
})
