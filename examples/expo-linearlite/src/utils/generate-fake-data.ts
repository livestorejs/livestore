import { faker } from '@faker-js/faker'
import { nanoid } from '@livestore/livestore'

import type { Comment, Issue, Reaction, User } from '../livestore/schema.ts'
import { PRIORITIES, STATUSES } from '../types.ts'

export const createRandomUser = (): User => ({
  id: nanoid(),
  name: faker.person.firstName(),
  email: faker.internet.email(),
  photoUrl: faker.image.avatar(),
})

export const createRandomIssue = (assigneeId: string): Issue => {
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
    id: nanoid(),
    title,
    description: faker.lorem.sentences({ min: 1, max: 2 }),
    parentIssueId: null,
    assigneeId,
    status: randomValueFromArray(Object.values(STATUSES)),
    priority: randomValueFromArray(Object.values(PRIORITIES)),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  }
}

export const createRandomComment = (issueId: string, userId: string): Comment => {
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

export const createRandomReaction = (issueId: string, userId: string, commentId: string): Reaction => ({
  id: nanoid(),
  issueId,
  commentId,
  userId,
  emoji: randomValueFromArray(emojies),
})

export const randomValueFromArray = <T>(array: readonly T[]): T => {
  if (array.length === 0) throw new Error('Array is empty')

  return array[Math.floor(Math.random() * array.length)]!
}

const emojies = ['👍', '👎', '💯', '👀', '🤔', '✅', '🔥']
