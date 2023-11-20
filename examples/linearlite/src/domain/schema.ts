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

const comment = DbSchema.table(
  'comment',
  {
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    issueId: DbSchema.text(),
    created: DbSchema.integer(),
    author: DbSchema.text({ nullable: false }),
  },
  [
    {
      name: 'issue_id',
      columns: ['issueId'],
    },
  ],
)

const appState = DbSchema.table('app_state', {
  key: DbSchema.text({ primaryKey: true }),
  value: DbSchema.text(),
})

export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>

export const schema = makeSchema({
  tables: { issue, description, comment, appState },
  actions: {
    addIssue: {
      statement: {
        sql: sql`INSERT INTO issue ("id", "title", "priority", "status", "created", "modified")
          VALUES ($id, $title, $priority, $status, $created, $modified)`,
        writeTables: ['issue'],
      },
      addDescription: {
        statement: {
          sql: sql`INSERT INTO description ("id", "body") VALUES ($id, $body)`,
          writeTables: ['description'],
        },
      },
      addComment: {
        statement: {
          sql: sql`INSERT INTO comment ("id", "body", "issueId", "created", "author")
          VALUES ($id, $body, $issueId, $created, $author)`,
          writeTables: ['comment'],
        },
      },
      deleteIssue: {
        statement: {
          sql: sql`DELETE FROM issue WHERE id = $id`,
          writeTables: ['issue'],
        },
      },
      deleteDescriptin: {
        statement: {
          sql: sql`DELETE FROM description WHERE id = $id`,
          writeTables: ['description'],
        },
      },
      deleteComment: {
        statement: {
          sql: sql`DELETE FROM comment WHERE id = $id`,
          writeTables: ['comment'],
        },
      },
      updateIssue: {
        statement: {
          sql: sql`UPDATE issue SET title = $title, priority = $priority, status = $status, modified = $modified WHERE id = $id`,
          writeTables: ['issue'],
        },
      },
      updateDescription: {
        statement: {
          sql: sql`UPDATE description SET body = $body WHERE id = $id`,
          writeTables: ['description'],
        },
      },
      upsertAppAtom: {
        statement: {
          sql: sql`INSERT INTO app_state (key, value) VALUES ($key, $value)
          ON CONFLICT (key) DO UPDATE SET value = $value`,
          writeTables: ['app_state'],
        },
      },
    },
  },
})
