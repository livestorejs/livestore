import { DbSchema, makeSchema, sql } from '@livestore/livestore'
import { Priority, Status } from '../types/issue'

const issue = DbSchema.table('issue', {
  id: DbSchema.text({ primaryKey: true }),
  title: DbSchema.text({ default: '' }),
  creator: DbSchema.text({ default: '' }),
  priority: DbSchema.text({ default: Priority.NONE }),
  status: DbSchema.text({ default: Status.TODO }),
  created: DbSchema.integer(),
  modified: DbSchema.integer(),
})

const description = DbSchema.table('description', {
  // TODO: id is also a foreign key to issue
  id: DbSchema.text({ primaryKey: true }),
  body: DbSchema.text({ default: '' }),
})

const comment = DbSchema.table('comment', {
  id: DbSchema.text({ primaryKey: true }),
  body: DbSchema.text({ default: '' }),
  creator: DbSchema.text({ default: '' }),
  issueId: DbSchema.text(),
  created: DbSchema.integer(),
})

// const app = DbSchema.table('app', {
//   id: DbSchema.textWithSchema(Schema.literal('static'), { primaryKey: true }),
//   newTodoText: DbSchema.text({ default: '' }),
//   filter: DbSchema.textWithSchema(Filter, { default: 'all' }),
// })

export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>

export const schema = makeSchema({
  tables: { issue, description, comment },
  actions: {
    // TODO: fix these actions to make them have write annotatinos
    addTodo: {
      statement: {
        sql: sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false);`,
        writeTables: ['todos'],
      },
    },
  },
})
