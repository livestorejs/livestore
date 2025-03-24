import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { defineMutation, Schema, sql } from '@livestore/livestore'

export const createIssueWithDescription = defineMutation(
  'createIssueWithDescription',
  Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    created: Schema.Number,
    modified: Schema.Number,
    kanbanorder: Schema.String,
    description: Schema.String,
    creator: Schema.String,
  }),
  [
    sql`INSERT INTO issue ("id", "title", "priority", "status", "created", "modified", "kanbanorder", "creator")
                        VALUES ($id, $title, $priority, $status, $created, $modified, $kanbanorder, $creator)`,
    sql`INSERT INTO description ("id", "body") VALUES ($id, $description)`,
  ],
)

export const createComment = defineMutation(
  'createComment',
  Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    issueId: Schema.Number,
    created: Schema.Number,
    creator: Schema.String,
  }),
  sql`INSERT INTO comment ("id", "body", "issueId", "created", "creator")
                        VALUES ($id, $body, $issueId, $created, $creator)`,
)

export const deleteIssue = defineMutation(
  'deleteIssue',
  Schema.Struct({ id: Schema.Number, deleted: Schema.Number }),
  sql`UPDATE issue SET deleted = $deleted WHERE id = $id`,
)

export const deleteDescription = defineMutation(
  'deleteDescription',
  Schema.Struct({ id: Schema.Number, deleted: Schema.Number }),
  sql`UPDATE description SET deleted = $deleted WHERE id = $id`,
)

export const deleteComment = defineMutation(
  'deleteComment',
  Schema.Struct({ id: Schema.String, deleted: Schema.DateFromNumber }),
  sql`UPDATE comment SET deleted = $deleted WHERE id = $id`,
)

export const deleteCommentsByIssueId = defineMutation(
  'deleteCommentsByIssueId',
  Schema.Struct({ issueId: Schema.Number, deleted: Schema.Number }),
  sql`UPDATE comment SET deleted = $deleted WHERE issueId = $issueId`,
)

export const updateIssue = defineMutation(
  'updateIssue',
  Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    modified: Schema.Number,
  }),
  sql`UPDATE issue SET title = $title, priority = $priority, status = $status, modified = $modified WHERE id = $id`,
)

export const updateIssueStatus = defineMutation(
  'updateIssueStatus',
  Schema.Struct({ id: Schema.Number, status: Status }),
  sql`UPDATE issue SET status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueKanbanOrder = defineMutation(
  'updateIssueKanbanOrder',
  Schema.Struct({ id: Schema.Number, status: Status, kanbanorder: Schema.String }),
  sql`UPDATE issue SET status = $status, kanbanorder = $kanbanorder, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueTitle = defineMutation(
  'updateIssueTitle',
  Schema.Struct({ id: Schema.Number, title: Schema.String }),
  sql`UPDATE issue SET title = $title, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const moveIssue = defineMutation(
  'moveIssue',
  Schema.Struct({ id: Schema.Number, kanbanorder: Schema.String, status: Status }),
  sql`UPDATE issue SET kanbanorder = $kanbanorder, status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssuePriority = defineMutation(
  'updateIssuePriority',
  Schema.Struct({ id: Schema.Number, priority: Priority }),
  sql`UPDATE issue SET priority = $priority, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateDescription = defineMutation(
  'updateDescription',
  Schema.Struct({ id: Schema.Number, body: Schema.String }),
  sql`UPDATE description SET body = $body WHERE id = $id`,
)
