import { faker } from '@faker-js/faker'
import { nanoid } from '@livestore/livestore'

import type { Priority, Status } from '@/types.ts'

type SeedIssue = {
  id: number
  title: string
  description: string | null
  parentIssueId: string | null
  assigneeId: string
  status: Status
  priority: Priority
  createdAt: Date
  updatedAt: Date
  deletedAt: null
}

type SeedComment = {
  id: string
  issueId: number
  userId: string
  content: string
  createdAt: Date
  updatedAt: Date
}

type SeedReaction = {
  id: string
  issueId: string
  commentId: string
  userId: string
  emoji: string
}

export const createRandomUser = (): { id: string; name: string; email: string; photoUrl: string | null } => ({
  id: nanoid(),
  name: faker.person.firstName(),
  email: faker.internet.email(),
  photoUrl: faker.image.avatar(),
})

export const createRandomIssue = (assigneeId: string, idOverride?: number): SeedIssue => {
  const actions = ['Fix', 'Update', 'Implement', 'Debug', 'Optimize', 'Refactor', 'Add']
  const subjects = [
    'login flow',
    'navigation',
    'dark mode',
    'performance',
    'database queries',
    'UI components',
    'error handling',
    'user settings',
    'notifications',
    'search functionality',
  ]
  const title = `${randomValueFromArray(actions)} ${randomValueFromArray(subjects)}`
  const createdAt = faker.date.recent()

  return {
    // Local numeric id for staging; caller can override to enforce sequencing
    id: idOverride ?? Date.now() + Math.floor(Math.random() * 1_000_000),
    title,
    description: faker.lorem.sentences({ min: 1, max: 2 }),
    parentIssueId: null,
    assigneeId,
    status: randomValueFromArray(Array.from({ length: 5 }, (_, index) => index)) as Status,
    priority: randomValueFromArray(Array.from({ length: 5 }, (_, index) => index)) as Priority,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  }
}

import { queryDb, Schema, type Store, sql } from '@livestore/livestore'

export const makeNextIssueId = (store: Store) => {
  const { maxId } = store.query(
    queryDb(
      {
        query: sql`SELECT COALESCE(MAX(id), 0) AS maxId FROM issues`,
        schema: Schema.Struct({ maxId: Schema.Number }).pipe(Schema.Array, Schema.headOrElse()),
      },
      { label: 'max-issue-id', deps: ['issues'] },
    ),
  )
  let next = maxId + 1
  return () => next++
}

export const createRandomComment = (issueId: number, userId: string): SeedComment => {
  const createdAt = faker.date.recent()
  return {
    id: nanoid(),
    issueId,
    userId,
    content: faker.lorem.sentences({ min: 1, max: 2 }),
    createdAt,
    updatedAt: createdAt,
  }
}

export const createRandomReaction = (issueId: number, userId: string, commentId: string): SeedReaction => ({
  id: nanoid(),
  issueId: String(issueId),
  commentId,
  userId,
  emoji: randomValueFromArray(emojies),
})

export const randomValueFromArray = <T>(array: readonly T[]): T => {
  if (array.length === 0) throw new Error('Array is empty')

  return array[Math.floor(Math.random() * array.length)]!
}

const emojies = ['👍', '👎', '💯', '👀', '🤔', '✅', '🔥']
