import { DbSchema, makeSchema, sql } from '@livestore/livestore'
import { Priority, PriorityType, Status, StatusType } from '../types/issue'

const issue = DbSchema.table('issue', {
  id: DbSchema.text({ primaryKey: true }),
  title: DbSchema.text({ default: '' }),
  creator: DbSchema.text({ default: '' }),
  priority: DbSchema.text({ default: Priority.NONE }),
  status: DbSchema.text({ default: Status.TODO }),
  created: DbSchema.integer(),
  modified: DbSchema.integer(),
  kanbanorder: DbSchema.text({ nullable: false }),
})

export interface FilterState {
  orderBy: string
  orderDirection: 'asc' | 'desc'
  status?: StatusType[]
  priority?: PriorityType[]
  query?: string
}

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
    // TODO: issueId is a foreign key to issue
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

// TODO: move filter state into its own table?
const appState = DbSchema.table('app_state', {
  key: DbSchema.text({ primaryKey: true }),
  value: DbSchema.text(),
})

export type AppState = DbSchema.FromTable.RowDecoded<typeof appState>
export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
export type Comment = DbSchema.FromTable.RowDecoded<typeof comment>

export const schema = makeSchema({
  // TODO get rid of `app_state` alias once fixed https://github.com/livestorejs/livestore/issues/25
  tables: { issue, description, comment, app_state: appState },
  actions: {
    createIssue: {
      statement: {
        sql: sql`INSERT INTO issue ("id", "title", "priority", "status", "created", "modified", "kanbanorder")
          VALUES ($id, $title, $priority, $status, $created, $modified, $kanbanorder)`,
        writeTables: ['issue'],
      },
    },
    createDescription: {
      statement: {
        sql: sql`INSERT INTO description ("id", "body") VALUES ($id, $body)`,
        writeTables: ['description'],
      },
    },
    createComment: {
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
    updateIssueKanbanOrder: {
      statement: {
        sql: sql`UPDATE issue SET kanbanorder = $kanbanorder, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    moveIssue: {
      statement: {
        sql: sql`UPDATE issue SET kanbanorder = $kanbanorder, status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    updatePriority: {
      statement: {
        sql: sql`UPDATE issue SET priority = $priority, modified = unixepoch() * 1000 WHERE id = $id`,
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
})
