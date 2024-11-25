import { Schema } from 'effect'
import { defineMutation, sql } from '@livestore/livestore'
import { PriorityType, StatusType } from '../types/issue'

export const createIssueWithDescription = defineMutation(
  'createIssueWithDescription',
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    priority: PriorityType,
    status: StatusType,
    created: Schema.Number,
    modified: Schema.Number,
    kanbanorder: Schema.String,
    description: Schema.String,
  }),
  [
    sql`INSERT INTO issue ("id", "title", "priority", "status", "created", "modified", "kanbanorder")
                        VALUES ($id, $title, $priority, $status, $created, $modified, $kanbanorder)`,
    sql`INSERT INTO description ("id", "body") VALUES ($id, $description)`,
  ],
)

export const createComment = defineMutation(
  'createComment',
  Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    issueId: Schema.String,
    created: Schema.Number,
    creator: Schema.String,
  }),
  sql`INSERT INTO comment ("id", "body", "issueId", "created", "creator")
                        VALUES ($id, $body, $issueId, $created, $creator)`,
)

export const deleteIssue = defineMutation(
  'deleteIssue',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE issue SET deleted = $deleted WHERE id = $id`,
)

export const deleteDescription = defineMutation(
  'deleteDescription',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE description SET deleted = $deleted WHERE id = $id`,
)

export const deleteComment = defineMutation(
  'deleteComment',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE comment SET deleted = $deleted WHERE id = $id`,
)

export const deleteCommentsByIssueId = defineMutation(
  'deleteCommentsByIssueId',
  Schema.Struct({ issueId: Schema.String, deleted: Schema.Number }),
  sql`UPDATE comment SET deleted = $deleted WHERE issueId = $issueId`,
)

export const updateIssue = defineMutation(
  'updateIssue',
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    priority: PriorityType,
    status: StatusType,
    modified: Schema.Number,
  }),
  sql`UPDATE issue SET title = $title, priority = $priority, status = $status, modified = $modified WHERE id = $id`,
)

export const updateIssueStatus = defineMutation(
  'updateIssueStatus',
  Schema.Struct({ id: Schema.String, status: StatusType }),
  sql`UPDATE issue SET status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueKanbanOrder = defineMutation(
  'updateIssueKanbanOrder',
  Schema.Struct({ id: Schema.String, kanbanorder: Schema.String }),
  sql`UPDATE issue SET kanbanorder = $kanbanorder, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueTitle = defineMutation(
  'updateIssueTitle',
  Schema.Struct({ id: Schema.String, title: Schema.String }),
  sql`UPDATE issue SET title = $title, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const moveIssue = defineMutation(
  'moveIssue',
  Schema.Struct({ id: Schema.String, kanbanorder: Schema.String, status: StatusType }),
  sql`UPDATE issue SET kanbanorder = $kanbanorder, status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssuePriority = defineMutation(
  'updateIssuePriority',
  Schema.Struct({ id: Schema.String, priority: PriorityType }),
  sql`UPDATE issue SET priority = $priority, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateDescription = defineMutation(
  'updateDescription',
  Schema.Struct({ id: Schema.String, body: Schema.String }),
  sql`UPDATE description SET body = $body WHERE id = $id`,
)
