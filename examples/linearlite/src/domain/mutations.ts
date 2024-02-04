import { Schema } from '@effect/schema'
import { defineMutation, sql } from '@livestore/livestore'
import { PriorityType, StatusType } from '../types/issue'

export const createIssue = defineMutation(
  'createIssue',
  Schema.struct({
    id: Schema.string,
    title: Schema.string,
    priority: PriorityType,
    status: StatusType,
    created: Schema.number,
    modified: Schema.number,
    kanbanorder: Schema.string,
  }),
  sql`INSERT INTO issue ("id", "title", "priority", "status", "created", "modified", "kanbanorder")
                        VALUES ($id, $title, $priority, $status, $created, $modified, $kanbanorder)`,
)

export const createDescription = defineMutation(
  'createDescription',
  Schema.struct({ id: Schema.string, body: Schema.string }),
  sql`INSERT INTO description ("id", "body") VALUES ($id, $body)`,
)

export const createComment = defineMutation(
  'createComment',
  Schema.struct({
    id: Schema.string,
    body: Schema.string,
    issueId: Schema.string,
    created: Schema.number,
    creator: Schema.string,
  }),
  sql`INSERT INTO comment ("id", "body", "issueId", "created", "creator")
                        VALUES ($id, $body, $issueId, $created, $creator)`,
)

export const deleteIssue = defineMutation(
  'deleteIssue',
  Schema.struct({ id: Schema.string }),
  sql`DELETE FROM issue WHERE id = $id`,
)

export const deleteDescription = defineMutation(
  'deleteDescription',
  Schema.struct({ id: Schema.string }),
  sql`DELETE FROM description WHERE id = $id`,
)

export const deleteComment = defineMutation(
  'deleteComment',
  Schema.struct({ id: Schema.string }),
  sql`DELETE FROM comment WHERE id = $id`,
)

export const deleteCommentsByIssueId = defineMutation(
  'deleteCommentsByIssueId',
  Schema.struct({ issueId: Schema.string }),
  sql`DELETE FROM comment WHERE issueId = $issueId`,
)

export const updateIssue = defineMutation(
  'updateIssue',
  Schema.struct({
    id: Schema.string,
    title: Schema.string,
    priority: PriorityType,
    status: StatusType,
    modified: Schema.number,
  }),
  sql`UPDATE issue SET title = $title, priority = $priority, status = $status, modified = $modified WHERE id = $id`,
)

export const updateIssueStatus = defineMutation(
  'updateIssueStatus',
  Schema.struct({ id: Schema.string, status: StatusType }),
  sql`UPDATE issue SET status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueKanbanOrder = defineMutation(
  'updateIssueKanbanOrder',
  Schema.struct({ id: Schema.string, kanbanorder: Schema.string }),
  sql`UPDATE issue SET kanbanorder = $kanbanorder, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssueTitle = defineMutation(
  'updateIssueTitle',
  Schema.struct({ id: Schema.string, title: Schema.string }),
  sql`UPDATE issue SET title = $title, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const moveIssue = defineMutation(
  'moveIssue',
  Schema.struct({ id: Schema.string, kanbanorder: Schema.string, status: StatusType }),
  sql`UPDATE issue SET kanbanorder = $kanbanorder, status = $status, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateIssuePriority = defineMutation(
  'updateIssuePriority',
  Schema.struct({ id: Schema.string, priority: PriorityType }),
  sql`UPDATE issue SET priority = $priority, modified = unixepoch() * 1000 WHERE id = $id`,
)

export const updateDescription = defineMutation(
  'updateDescription',
  Schema.struct({ id: Schema.string, body: Schema.string }),
  sql`UPDATE description SET body = $body WHERE id = $id`,
)
