import { makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import { Filter, Priority, Status } from '../types.ts'
import * as eventsDefs from './events.ts'

// Table Definitions

const issues = State.SQLite.table({
  name: 'issues',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    title: State.SQLite.text(),
    description: State.SQLite.text({ nullable: true }),
    parentIssueId: State.SQLite.text({ nullable: true }),
    assigneeId: State.SQLite.text({ nullable: true }),
    assigneeName: State.SQLite.text({ nullable: true }),
    status: State.SQLite.integer({ schema: Status }),
    priority: State.SQLite.integer({ schema: Priority }),
    createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    updatedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

const comments = State.SQLite.table({
  name: 'comments',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.integer(),
    userId: State.SQLite.text(),
    authorName: State.SQLite.text({ nullable: true }),
    content: State.SQLite.text(),
    createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    updatedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
  },
})

const reactions = State.SQLite.table({
  name: 'reactions',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text(),
    commentId: State.SQLite.text(),
    userId: State.SQLite.text(),
    emoji: State.SQLite.text(),
  },
})

export type Issue = typeof issues.Type
export type Comment = typeof comments.Type
export type Reaction = typeof reactions.Type

const uiState = State.SQLite.clientDocument({
  name: 'uiState',
  // TODO refine schemas (e.g. via literals)
  schema: Schema.Struct({
    newIssueText: Schema.String,
    newIssueDescription: Schema.String,
    filter: Filter,
    selectedHomeTab: Schema.Literal('assigned', 'created', 'all'),
    currentUserName: Schema.String,
    currentUserId: Schema.String,
    assignedTabGrouping: Schema.String,
    assignedTabOrdering: Schema.String,
    assignedTabCompletedIssues: Schema.String,
    createdTabGrouping: Schema.String,
    createdTabOrdering: Schema.String,
    createdTabCompletedIssues: Schema.String,
    assignedTabShowAssignee: Schema.Boolean,
    assignedTabShowStatus: Schema.Boolean,
    assignedTabShowPriority: Schema.Boolean,
    createdTabShowAssignee: Schema.Boolean,
    createdTabShowStatus: Schema.Boolean,
    createdTabShowPriority: Schema.Boolean,
    navigationHistory: Schema.String,
  }),
  default: {
    id: SessionIdSymbol,
    value: {
      newIssueText: '',
      newIssueDescription: '',
      filter: 'all',
      // Align default lineup with Web LinearLite: show all issues, newest first
      selectedHomeTab: 'all',
      currentUserName: '',
      currentUserId: '',
      assignedTabGrouping: 'NoGrouping',
      assignedTabOrdering: 'Last Created',
      assignedTabCompletedIssues: 'week',
      createdTabGrouping: 'NoGrouping',
      createdTabOrdering: 'Last Created',
      createdTabCompletedIssues: 'week',
      assignedTabShowAssignee: true,
      assignedTabShowStatus: true,
      assignedTabShowPriority: true,
      createdTabShowAssignee: true,
      createdTabShowStatus: true,
      createdTabShowPriority: true,
      navigationHistory: '',
    },
  },
})

export type UiState = typeof uiState.Value

export const tables = { issues, comments, reactions, uiState }

export const events = {
  ...eventsDefs,
  uiStateSet: uiState.set,
}

const DEFAULT_USER_ID = 'default-user'

const userIdFromName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') || DEFAULT_USER_ID

const materializers = State.SQLite.materializers(events, {
  // Create issue and map fields to Expo tables; derive assignee from `creator`
  'v1.CreateIssueWithDescription': ({ id, title, description, status, priority, created, modified, creator }) => [
    issues.insert({
      id,
      title,
      description,
      parentIssueId: null,
      assigneeId: userIdFromName(creator),
      assigneeName: creator,
      status,
      priority,
      createdAt: created,
      updatedAt: modified,
      deletedAt: null,
    }),
  ],
  'v1.DeleteIssue': ({ id, deleted }) => issues.update({ deletedAt: deleted }).where({ id }),
  'v1.UpdateIssueTitle': ({ id, title, modified }) => issues.update({ title, updatedAt: modified }).where({ id }),
  'v1.DeleteDescription': ({ id }) => issues.update({ description: null }).where({ id }),
  'v1.UpdateDescription': ({ id, body }) => issues.update({ description: body }).where({ id }),
  'v1.UpdateIssue': ({ id, title, priority, status, modified }) =>
    issues
      .update({
        title,
        priority,
        status,
        updatedAt: modified,
      })
      .where({ id }),
  'v1.UpdateIssueStatus': ({ id, status, modified }) => issues.update({ status, updatedAt: modified }).where({ id }),
  'v1.UpdateIssuePriority': ({ id, priority, modified }) =>
    issues.update({ priority, updatedAt: modified }).where({ id }),
  'v1.UpdateIssueKanbanOrder': ({ id, status, modified }) =>
    issues.update({ status, updatedAt: modified }).where({ id }),
  'v1.MoveIssue': ({ id, status, modified }) => issues.update({ status, updatedAt: modified }).where({ id }),

  // Comments mapping
  'v1.CreateComment': ({ id, body, issueId, created, creator }) => [
    comments.insert({
      id,
      issueId,
      userId: userIdFromName(creator),
      authorName: creator,
      content: body,
      createdAt: created,
      updatedAt: created,
    }),
  ],
  'v1.DeleteComment': ({ id }) => comments.delete().where({ id }),
  'v1.DeleteCommentsByIssueId': ({ issueId }) => comments.delete().where({ issueId }),
  'v1.ReactionCreated': ({ id, issueId, commentId, userId, emoji }) =>
    reactions.insert({ id, issueId, commentId, userId, emoji }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
