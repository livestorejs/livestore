import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react'
import { issueEvents, issueTables, schema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

// Simple function to generate issue titles by using alphabet letters sequentially
let issueCount = 0
const generateIssueTitle = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const title = `Issue ${alphabet[issueCount % alphabet.length]}`
  issueCount += 1
  return title
}

export const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter,
    gcTime: 20_000,
    boot: (store) => {
      // In a real-world app, you would handle seeding in the server by subscribing to the workspaceEvents.issueCreated event
      if (store.query(issueTables.issue.count()) === 0) {
        store.commit(
          issueEvents.issueCreated({
            id: issueId,
            workspaceId: 'workspace-root',
            title: generateIssueTitle(),
            createdAt: new Date(),
            ...(!issueId.includes('sub') && {
              childIssueIds: [`${issueId}-sub-b`, `${issueId}-sub-a`],
            }),
          }),
        )
      }
    },
  })
