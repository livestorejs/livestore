import { Events, makeSchema, Schema, State } from '@livestore/livestore'

import { Filter } from '../types.ts'
import * as eventsDefs from './events.ts'

// Table Definitions
const users = State.SQLite.table({
  name: 'users',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    email: State.SQLite.text({ nullable: true }),
    photoUrl: State.SQLite.text({ nullable: true }),
  },
})

const issues = State.SQLite.table({
  name: 'issues',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text(),
    description: State.SQLite.text({ nullable: true }),
    parentIssueId: State.SQLite.text({ nullable: true }),
    assigneeId: State.SQLite.text({ nullable: true }),
    status: State.SQLite.text(),
    priority: State.SQLite.text(),
    createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    updatedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
})

const comments = State.SQLite.table({
  name: 'comments',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text(),
    userId: State.SQLite.text(),
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
export type User = typeof users.Type
export type Comment = typeof comments.Type
export type Reaction = typeof reactions.Type

const UiStateSchema = Schema.Struct({
  newIssueText: Schema.String,
  newIssueDescription: Schema.String,
  filter: Filter,
  selectedHomeTab: Schema.Literal('assigned', 'created'),
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
})

export type UiState = typeof UiStateSchema.Type

export const defaultUiState: UiState = {
  newIssueText: '',
  newIssueDescription: '',
  filter: 'all',
  selectedHomeTab: 'assigned',
  assignedTabGrouping: 'status',
  assignedTabOrdering: 'priority',
  assignedTabCompletedIssues: 'week',
  createdTabGrouping: 'status',
  createdTabOrdering: 'priority',
  createdTabCompletedIssues: 'week',
  assignedTabShowAssignee: true,
  assignedTabShowStatus: true,
  assignedTabShowPriority: true,
  createdTabShowAssignee: true,
  createdTabShowStatus: true,
  createdTabShowPriority: true,
  navigationHistory: '',
}

const uiState = State.SQLite.table({
  name: 'uiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    value: State.SQLite.json({ schema: UiStateSchema, default: defaultUiState }),
  },
})

export const tables = { issues, users, comments, reactions, uiState }

export const events = {
  ...eventsDefs,
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.partial(UiStateSchema),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.IssueCreated': ({ id, title, description, parentIssueId, assigneeId, status, priority, createdAt, updatedAt }) =>
    issues.insert({
      id,
      title,
      description,
      parentIssueId,
      assigneeId,
      status,
      priority,
      createdAt,
      updatedAt,
    }),
  'v1.IssueDeleted': ({ id, deletedAt }) => issues.update({ deletedAt }).where({ id }),
  'v1.IssueTitleUpdated': ({ id, title, updatedAt }) => issues.update({ title, updatedAt }).where({ id }),
  'v1.IssueDescriptionUpdated': ({ id, description, updatedAt }) =>
    issues.update({ description, updatedAt }).where({ id }),
  'v1.IssueRestored': ({ id }) => issues.update({ deletedAt: null }).where({ id }),
  'v1.UserCreated': ({ id, name, email, photoUrl }) => users.insert({ id, name, email, photoUrl }),
  'v1.UserDeleted': ({ id }) => users.delete().where({ id }),
  'v1.CommentCreated': ({ id, issueId, userId, content, createdAt, updatedAt }) =>
    comments.insert({ id, issueId, userId, content, createdAt, updatedAt }),
  'v1.ReactionCreated': ({ id, issueId, commentId, userId, emoji }) =>
    reactions.insert({ id, issueId, commentId, userId, emoji }),
  'v1.AllCleared': ({ deletedAt }) => issues.update({ deletedAt }).where({ deletedAt: null }),
  'v1.UiStateSet': (patch) =>
    uiState
      .insert({ id: 'default', value: { ...defaultUiState, ...patch } })
      .onConflict('id', 'update', { value: { ...defaultUiState, ...patch } }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
