import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { Events, Schema } from '@livestore/livestore'

export const createIssueWithDescription = Events.global({
  name: 'v1.CreateIssueWithDescription',
  schema: Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    created: Schema.DateFromNumber,
    modified: Schema.DateFromNumber,
    kanbanorder: Schema.String,
    description: Schema.String,
    creator: Schema.String,
  }),
})

export const createComment = Events.global({
  name: 'v1.CreateComment',
  schema: Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    issueId: Schema.Number,
    created: Schema.DateFromNumber,
    creator: Schema.String,
  }),
})

export const deleteIssue = Events.global({
  name: 'v1.DeleteIssue',
  schema: Schema.Struct({ id: Schema.Number, deleted: Schema.DateFromNumber }),
})

export const deleteDescription = Events.global({
  name: 'v1.DeleteDescription',
  schema: Schema.Struct({ id: Schema.Number, deleted: Schema.DateFromNumber }),
})

export const deleteComment = Events.global({
  name: 'v1.DeleteComment',
  schema: Schema.Struct({ id: Schema.String, deleted: Schema.DateFromNumber }),
})

export const deleteCommentsByIssueId = Events.global({
  name: 'v1.DeleteCommentsByIssueId',
  schema: Schema.Struct({ issueId: Schema.Number, deleted: Schema.DateFromNumber }),
})

export const updateIssue = Events.global({
  name: 'v1.UpdateIssue',
  schema: Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    priority: Priority,
    status: Status,
    modified: Schema.DateFromNumber,
  }),
})

export const updateIssueStatus = Events.global({
  name: 'v1.UpdateIssueStatus',
  schema: Schema.Struct({ id: Schema.Number, status: Status, modified: Schema.DateFromNumber }),
})

export const updateIssueKanbanOrder = Events.global({
  name: 'v1.UpdateIssueKanbanOrder',
  schema: Schema.Struct({
    id: Schema.Number,
    status: Status,
    kanbanorder: Schema.String,
    modified: Schema.DateFromNumber,
  }),
})

export const updateIssueTitle = Events.global({
  name: 'v1.UpdateIssueTitle',
  schema: Schema.Struct({ id: Schema.Number, title: Schema.String, modified: Schema.DateFromNumber }),
})

export const moveIssue = Events.global({
  name: 'v1.MoveIssue',
  schema: Schema.Struct({
    id: Schema.Number,
    kanbanorder: Schema.String,
    status: Status,
    modified: Schema.DateFromNumber,
  }),
})

export const updateIssuePriority = Events.global({
  name: 'v1.UpdateIssuePriority',
  schema: Schema.Struct({ id: Schema.Number, priority: Priority, modified: Schema.DateFromNumber }),
})

export const updateDescription = Events.global({
  name: 'v1.UpdateDescription',
  schema: Schema.Struct({ id: Schema.Number, body: Schema.String }),
})
