import { DbSchema, makeSchema } from '@livestore/common/schema'

export * as Bridge from './bridge.js'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
  { deriveMutations: true },
)

export const schema = makeSchema({ tables: [todos] })
