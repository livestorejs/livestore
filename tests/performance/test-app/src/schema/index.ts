import { DbSchema, makeSchema } from '@livestore/livestore'

import * as mutations from './mutations.ts'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '' }),
    completed: DbSchema.boolean({ default: false }),
    deleted: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: true },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>

export const tables = { todos }

export const schema = makeSchema({
  tables,
  mutations,
  migrations: { strategy: 'from-mutation-log' },
})

export * as mutations from './mutations.ts'
