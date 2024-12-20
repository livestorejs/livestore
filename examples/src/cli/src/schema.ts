import { DbSchema, makeSchema } from '@livestore/common/schema'

const todo = DbSchema.table(
  'todo',
  {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text(),
  },
  { deriveMutations: true },
)

export const tables = { todo }
export const schema = makeSchema({ tables })
