import { DbSchema, makeSchema } from '@livestore/livestore'

import * as mutations from './mutations.ts'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }), // Unique identifier for each todo item
    text: DbSchema.text({ default: '' }), // Text content of the todo
    completed: DbSchema.boolean({ default: false }), // Status of the todo item
    deleted: DbSchema.integer({ nullable: true }), // Optional field to mark deletion
  },
  { deriveMutations: true }, // Automatically derive mutations for this table
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>

export const tables = {
  todos,
}

export const schema = makeSchema({
  tables,
  mutations: {
    // Add more mutations
    ...mutations,
  },
  migrations: { strategy: 'from-mutation-log' }, // Define migration strategy
})

export * as mutations from './mutations.ts'
