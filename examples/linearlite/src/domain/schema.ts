import { DbSchema, makeSchema, sql } from '@livestore/livestore'
import { Priority, PriorityType, Status, StatusType } from '../types/issue'
import { Schema } from '@effect/schema'

const issue = DbSchema.table(
  'issue',
  {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    priority: DbSchema.text({ schema: PriorityType, default: Priority.NONE }),
    status: DbSchema.text({ schema: StatusType, default: Status.TODO }),
    created: DbSchema.integer(),
    modified: DbSchema.integer(),
    kanbanorder: DbSchema.text({ nullable: false }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
  },
)

const OrderDirection = Schema.literal('asc', 'desc')
export type OrderDirection = Schema.Schema.To<typeof OrderDirection>

const OrderBy = Schema.literal('priority', 'status', 'created', 'modified')
export type OrderBy = Schema.Schema.To<typeof OrderBy>

export const FilterState = Schema.struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.optional(Schema.array(StatusType)),
  priority: Schema.optional(Schema.array(PriorityType)),
  query: Schema.optional(Schema.string),
})

export const parseFilterStateString = Schema.decodeSync(Schema.compose(Schema.decodeJson(), FilterState))

export type FilterState = Schema.Schema.To<typeof FilterState>

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
  },
  {
    indexes: [
      {
        name: 'issue_id',
        columns: ['issueId'],
      },
    ],
  },
)

export const filterStateTable = DbSchema.table(
  'filter_state',
  DbSchema.json({ schema: FilterState, default: { orderBy: 'created', orderDirection: 'desc' } }),
  { isSingleton: true },
)

export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
export type Comment = DbSchema.FromTable.RowDecoded<typeof comment>

export const tables = { issue, description, comment, filterStateTable }
export const schema = makeSchema({
  tables,
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
        sql: sql`INSERT INTO comment ("id", "body", "issueId", "created", "creator")
          VALUES ($id, $body, $issueId, $created, $creator)`,
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
    deleteCommentsByIssueId: {
      statement: {
        sql: sql`DELETE FROM comment WHERE issueId = $issueId`,
        writeTables: ['comment'],
      },
    },
    updateIssue: {
      statement: {
        sql: sql`UPDATE issue SET title = $title, priority = $priority, status = $status, modified = $modified WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    updateIssueStatus: {
      statement: {
        sql: sql`UPDATE issue SET status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    updateIssueKanbanOrder: {
      statement: {
        sql: sql`UPDATE issue SET kanbanorder = $kanbanorder, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    updateIssueTitle: {
      statement: {
        sql: sql`UPDATE issue SET title = $title, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    moveIssue: {
      statement: {
        sql: sql`UPDATE issue SET kanbanorder = $kanbanorder, status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
        writeTables: ['issue'],
      },
    },
    updateIssuePriority: {
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
  },
})
