import { makeSchema, State } from '@livestore/livestore'

import { Filter, PRIORITIES, STATUSES } from '../types.ts'
import * as issuesMutations from './issues-mutations.ts'
import * as mutations from './mutations.ts'
import * as userMutations from './user-mutations.ts'

const app = State.SQLite.table(
  'app',
  {
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
    newIssueText: State.SQLite.text({ default: '' }),
    newIssueDescription: State.SQLite.text({ default: '' }),
    selectedHomeTab: State.SQLite.text({ default: 'Assigned' }), // Assigned, Created, Subscribed

    // Assigned tab config
    assignedTabGrouping: State.SQLite.text({ default: 'Status' }), // NoGrouping, Assignee, Priority, Status
    assignedTabOrdering: State.SQLite.text({ default: 'Priority' }), // Priority, Last Updated, Last Created
    assignedTabCompletedIssues: State.SQLite.text({ default: 'None' }), // None, Past Week, Past Month, Past Year
    assignedTabShowAssignee: State.SQLite.boolean({ default: false }),
    assignedTabShowStatus: State.SQLite.boolean({ default: true }),
    assignedTabShowPriority: State.SQLite.boolean({ default: true }),

    // Created tab config
    createdTabGrouping: State.SQLite.text({ default: 'Assignee' }), // NoGrouping, Assignee, Priority, Status
    createdTabOrdering: State.SQLite.text({ default: 'Last Updated' }), // Last Updated, Last Created, Priority
    createdTabCompletedIssues: State.SQLite.text({ default: 'Past Month' }), // None, Past Week, Past Month, Past Year
    createdTabShowAssignee: State.SQLite.boolean({ default: true }),
    createdTabShowStatus: State.SQLite.boolean({ default: true }),
    createdTabShowPriority: State.SQLite.boolean({ default: false }),

    navigationHistory: State.SQLite.text({ default: '/' }),
  },
  { isSingleton: true, deriveEvents: true },
)

// Linearlite ↓

const users = State.SQLite.table(
  'users',
  {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text({ nullable: false }),
    email: State.SQLite.text({ nullable: true }),
    photoUrl: State.SQLite.text({ nullable: true }),
  },
  { deriveEvents: true },
)

const issues = State.SQLite.table(
  'issues',
  {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text({ nullable: false }),
    description: State.SQLite.text({ nullable: true }),
    parentIssueId: State.SQLite.text({ nullable: true }),
    assigneeId: State.SQLite.text({ nullable: true }),
    status: State.SQLite.text({ default: STATUSES.TODO }), // todo
    priority: State.SQLite.text({ default: PRIORITIES.NONE }), // no priority
    deletedAt: State.SQLite.integer({ nullable: true }),
    createdAt: State.SQLite.integer({ default: null, nullable: true }),
    updatedAt: State.SQLite.integer({ default: null, nullable: true }),
  },
  { deriveEvents: true },
)

const comments = State.SQLite.table(
  'comments',
  {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text({ nullable: false }),
    userId: State.SQLite.text({ nullable: false }),
    content: State.SQLite.text({ nullable: false }),
    createdAt: State.SQLite.integer({ default: null, nullable: true }),
    updatedAt: State.SQLite.integer({ default: null, nullable: true }),
  },
  { deriveEvents: true },
)

const reactions = State.SQLite.table(
  'reactions',
  {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text({ nullable: false }),
    commentId: State.SQLite.text({ nullable: false }),
    userId: State.SQLite.text({ nullable: false }),
    emoji: State.SQLite.text(),
  },
  { deriveEvents: true },
)

// Activity related to a specific issue
const activity = State.SQLite.table(
  'activity',
  {
    id: State.SQLite.text({ primaryKey: true }),
    issueId: State.SQLite.text({ nullable: false }),
    userId: State.SQLite.text({ nullable: false }),
    type: State.SQLite.text({ nullable: false }),
    data: State.SQLite.json({ nullable: true }), // extra json data of the activity e.g. { type: 'STATUS_CHANGED', from: 'open', to: 'closed' }
    commentId: State.SQLite.text({ nullable: true }), // if it's a comment we can get it by id directly
    createdAt: State.SQLite.integer({ default: null, nullable: true }),
  },
  { deriveEvents: true },
)

export type User = State.SQLite.FromTable.RowDecoded<typeof users>
export type Issue = State.SQLite.FromTable.RowDecoded<typeof issues>
export type Comment = State.SQLite.FromTable.RowDecoded<typeof comments>
export type Reaction = State.SQLite.FromTable.RowDecoded<typeof reactions>
export type Activity = State.SQLite.FromTable.RowDecoded<typeof activity>

export const tables = {
  app,
  users,
  issues,
  comments,
  reactions,
  activity,
}

export const schema = makeSchema({
  tables,
  mutations: {
    ...mutations,
    ...userMutations,
    ...issuesMutations,
  },
  migrations: { strategy: 'from-mutation-log' },
})

export * as mutations from './mutations.ts'
export * as userMutations from './user-mutations.ts'
export * as issuesMutations from './issues-mutations.ts'
