import { type Store } from '@livestore/livestore'

import { priorityOptions } from '@/data/priority-options'
import { statusOptions } from '@/data/status-options'
import { Issue, mutations, tables } from '@/lib/livestore/schema'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'

export const seed = (store: Store) => {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const seedParam = urlParams.get('seed')
    if (seedParam == null) return
    let count = parseInt(seedParam)
    const existingCount = store.query(tables.issue.query.count().where({ deleted: null }))
    if (existingCount >= count) return
    count -= existingCount
    console.log('SEEDING WITH ', count, ' ADDITIONAL ROWS')
    store.mutate(...Array.from(createIssues(count)).map((_) => mutations.createIssueWithDescription(_)))
  } finally {
    const url = new URL(window.location.href)
    url.searchParams.delete('seed')
    window.history.replaceState({}, '', url.toString())
  }
}

function* createIssues(numTasks: number): Generator<Issue & { description: string }> {
  const getRandomItem = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]!

  const generateText = () => {
    const action = getRandomItem(actionPhrases)
    const feature = getRandomItem(featurePhrases)
    const purpose = getRandomItem(purposePhrases)
    const context = getRandomItem(contextPhrases)
    return [`${action} ${feature}`, `${action} ${feature} ${purpose}. ${context}.`] as const
  }

  const now = Date.now()
  const ONE_DAY = 24 * 60 * 60 * 1000
  for (let i = 0; i < numTasks; i++) {
    const [title, description] = generateText()
    const issue = {
      id: i + 1,
      creator: 'John Doe',
      title,
      created: now - i * 5 * ONE_DAY,
      modified: now - i * 2 * ONE_DAY,
      deleted: null,
      status: getRandomItem(statuses),
      priority: getRandomItem(priorities),
      kanbanorder: 'a1',
      description,
    }
    yield issue
  }
}

export const priorities = Object.keys(priorityOptions) as Priority[]
export const statuses = Object.keys(statusOptions) as Status[]
const actionPhrases = [
  'Implement',
  'Develop',
  'Design',
  'Test',
  'Review',
  'Refactor',
  'Redesign',
  'Enhance',
  'Optimize',
  'Fix',
  'Remove',
  'Mock',
  'Update',
  'Document',
  'Deploy',
  'Revert',
  'Add',
  'Destroy',
]
const featurePhrases = [
  'the login mechanism',
  'the user dashboard',
  'the settings page',
  'database queries',
  'UI/UX components',
  'API endpoints',
  'the checkout process',
  'responsive layouts',
  'error handling logic',
  'the navigation menu',
  'the search functionality',
  'the onboarding flow',
  'the user profile page',
  'the admin dashboard',
  'the billing system',
  'the payment gateway',
  'the user permissions',
  'the user roles',
  'the user management',
]
const purposePhrases = [
  'to improve user experience',
  'to speed up load times',
  'to enhance security',
  'to prepare for the next release',
  'following the latest design mockups',
  'to address reported issues',
  'for better mobile responsiveness',
  'to comply with new regulations',
  'to reflect customer feedback',
  'to keep up with platform changes',
  'to improve overall performance',
  'to fix a critical bug',
  'to add a new feature',
  'to remove deprecated code',
  'to improve code readability',
  'to fix a security vulnerability',
  'to improve SEO',
  'to improve accessibility',
  'to improve the codebase',
]
const contextPhrases = [
  'Based on the latest UX research',
  'To ensure seamless user experience',
  'To cater to increasing user demands',
  'Keeping scalability in mind',
  'As outlined in the last meeting',
  'Following the latest design specifications',
  'To adhere to the updated requirements',
  'While ensuring backward compatibility',
  'To improve overall performance',
  'And ensure proper error feedback to the user',
]
