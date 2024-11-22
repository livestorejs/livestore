import { DbSchema, makeSchema } from '@livestore/livestore'

import { Filter, PRIORITIES, STATUSES } from '../types.ts'
import * as issuesMutations from './issues-mutations.ts'
import * as mutations from './mutations.ts'
import * as userMutations from './user-mutations.ts'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '' }),
    completed: DbSchema.boolean({ default: false }),
    deleted: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: true },
)

const app = DbSchema.table(
  'app',
  {
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.text({ schema: Filter, default: 'all' }),
    newIssueText: DbSchema.text({ default: '' }),
    newIssueDescription: DbSchema.text({ default: '' }),
    selectedHomeTab: DbSchema.text({ default: 'Assigned' }), // Assigned, Created, Subscribed

    // Assigned tab config
    assignedTabGrouping: DbSchema.text({ default: 'Status' }), // NoGrouping, Assignee, Priority, Status
    assignedTabOrdering: DbSchema.text({ default: 'Priority' }), // Priority, Last Updated, Last Created
    assignedTabCompletedIssues: DbSchema.text({ default: 'None' }), // None, Past Week, Past Month, Past Year
    assignedTabShowAssignee: DbSchema.boolean({ default: false }),
    assignedTabShowStatus: DbSchema.boolean({ default: true }),
    assignedTabShowPriority: DbSchema.boolean({ default: true }),

    // Created tab config
    createdTabGrouping: DbSchema.text({ default: 'Assignee' }), // NoGrouping, Assignee, Priority, Status
    createdTabOrdering: DbSchema.text({ default: 'Last Updated' }), // Last Updated, Last Created, Priority
    createdTabCompletedIssues: DbSchema.text({ default: 'Past Month' }), // None, Past Week, Past Month, Past Year
    createdTabShowAssignee: DbSchema.boolean({ default: true }),
    createdTabShowStatus: DbSchema.boolean({ default: true }),
    createdTabShowPriority: DbSchema.boolean({ default: false }),

    navigationHistory: DbSchema.text({ default: '/' }),
  },
  { isSingleton: true, deriveMutations: true },
)

// Linearlite ↓

const users = DbSchema.table(
  'users',
  {
    id: DbSchema.text({ primaryKey: true }),
    name: DbSchema.text({ nullable: false }),
    email: DbSchema.text({ nullable: true }),
    photoUrl: DbSchema.text({ nullable: true }),
  },
  { deriveMutations: true },
)

const issues = DbSchema.table(
  'issues',
  {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text({ nullable: false }),
    description: DbSchema.text({ nullable: true }),
    parentIssueId: DbSchema.text({ nullable: true }),
    assigneeId: DbSchema.text({ nullable: true }),
    status: DbSchema.text({ default: STATUSES.TODO }), // todo
    priority: DbSchema.text({ default: PRIORITIES.NONE }), // no priority
    deletedAt: DbSchema.integer({ nullable: true }),
    createdAt: DbSchema.integer({ default: null, nullable: true }),
    updatedAt: DbSchema.integer({ default: null, nullable: true }),
  },
  { deriveMutations: true },
)

const comments = DbSchema.table(
  'comments',
  {
    id: DbSchema.text({ primaryKey: true }),
    issueId: DbSchema.text({ nullable: false }),
    userId: DbSchema.text({ nullable: false }),
    content: DbSchema.text({ nullable: false }),
    createdAt: DbSchema.integer({ default: null, nullable: true }),
    updatedAt: DbSchema.integer({ default: null, nullable: true }),
  },
  { deriveMutations: true },
)

const reactions = DbSchema.table(
  'reactions',
  {
    id: DbSchema.text({ primaryKey: true }),
    issueId: DbSchema.text({ nullable: false }),
    commentId: DbSchema.text({ nullable: false }),
    userId: DbSchema.text({ nullable: false }),
    emoji: DbSchema.text(),
  },
  { deriveMutations: true },
)

// Activity related to a specific issue
const activity = DbSchema.table(
  'activity',
  {
    id: DbSchema.text({ primaryKey: true }),
    issueId: DbSchema.text({ nullable: false }),
    userId: DbSchema.text({ nullable: false }),
    type: DbSchema.text({ nullable: false }),
    data: DbSchema.json({ nullable: true }), // extra json data of the activity e.g. { type: 'STATUS_CHANGED', from: 'open', to: 'closed' }
    commentId: DbSchema.text({ nullable: true }), // if it's a comment we can get it by id directly
    createdAt: DbSchema.integer({ default: null, nullable: true }),
  },
  { deriveMutations: true },
)

export type User = DbSchema.FromTable.RowDecoded<typeof users>
export type Issue = DbSchema.FromTable.RowDecoded<typeof issues>
export type Comment = DbSchema.FromTable.RowDecoded<typeof comments>
export type Reaction = DbSchema.FromTable.RowDecoded<typeof reactions>
export type Activity = DbSchema.FromTable.RowDecoded<typeof activity>

export const tables = {
  todos,
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
