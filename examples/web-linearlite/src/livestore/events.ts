import { Events, Schema } from '@livestore/livestore'

import { Priority } from '../types/priority.ts'
import { Status } from '../types/status.ts'

export const createIssueWithDescription = Events.synced({
  name: 'v1.CreateIssueWithDescription',
  schema: Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    created: Schema.DateFromEpochMillis,
    modified: Schema.DateFromEpochMillis,
    kanbanorder: Schema.String,
    description: Schema.String,
    creator: Schema.String,
  }),
})

export const createComment = Events.synced({
  name: 'v1.CreateComment',
  schema: Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    issueId: Schema.Number,
    created: Schema.DateFromEpochMillis,
    creator: Schema.String,
  }),
})

export const deleteIssue = Events.synced({
  name: 'v1.DeleteIssue',
  schema: Schema.Struct({ id: Schema.Number, deleted: Schema.DateFromEpochMillis }),
})

export const deleteDescription = Events.synced({
  name: 'v1.DeleteDescription',
  schema: Schema.Struct({ id: Schema.Number, deleted: Schema.DateFromEpochMillis }),
})

export const deleteComment = Events.synced({
  name: 'v1.DeleteComment',
  schema: Schema.Struct({ id: Schema.String, deleted: Schema.DateFromEpochMillis }),
})

export const deleteCommentsByIssueId = Events.synced({
  name: 'v1.DeleteCommentsByIssueId',
  schema: Schema.Struct({ issueId: Schema.Number, deleted: Schema.DateFromEpochMillis }),
})

export const updateIssue = Events.synced({
  name: 'v1.UpdateIssue',
  schema: Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    modified: Schema.DateFromEpochMillis,
  }),
})

export const updateIssueStatus = Events.synced({
  name: 'v1.UpdateIssueStatus',
  schema: Schema.Struct({ id: Schema.Number, status: Status, modified: Schema.DateFromEpochMillis }),
})

export const updateIssueKanbanOrder = Events.synced({
  name: 'v1.UpdateIssueKanbanOrder',
  schema: Schema.Struct({
    id: Schema.Number,
    status: Status,
    kanbanorder: Schema.String,
    modified: Schema.DateFromEpochMillis,
  }),
})

export const updateIssueTitle = Events.synced({
  name: 'v1.UpdateIssueTitle',
  schema: Schema.Struct({ id: Schema.Number, title: Schema.String, modified: Schema.DateFromEpochMillis }),
})

export const moveIssue = Events.synced({
  name: 'v1.MoveIssue',
  schema: Schema.Struct({
    id: Schema.Number,
    kanbanorder: Schema.String,
    status: Status,
    modified: Schema.DateFromEpochMillis,
  }),
})

export const updateIssuePriority = Events.synced({
  name: 'v1.UpdateIssuePriority',
  schema: Schema.Struct({ id: Schema.Number, priority: Priority, modified: Schema.DateFromEpochMillis }),
})

export const updateDescription = Events.synced({
  name: 'v1.UpdateDescription',
  schema: Schema.Struct({ id: Schema.Number, body: Schema.String }),
})
