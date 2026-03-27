import { Suspense } from 'react'

import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'

import { tables } from './issue.schema.ts'
import { issueStoreOptions } from './issue.store.ts'

const issueLoadingFallback = <div>Loading issue...</div>

export const IssueView = ({ issueId }: { issueId: string }) => {
  // useStore() suspends the component until the store is loaded
  // If the same store was already loaded, it returns immediately
  const issueStore = useStore(issueStoreOptions(issueId))

  // Query data from the store
  const [issue] = issueStore.useQuery(queryDb(tables.issue.select().where({ id: issueId })))

  if (issue == null) return <div>Issue not found</div>

  return (
    <div>
      <h3>{issue.title}</h3>
      <p>Status: {issue.status}</p>
    </div>
  )
}

// Wrap with Suspense for loading states
export const IssueViewWithSuspense = ({ issueId }: { issueId: string }) => {
  return (
    <Suspense fallback={issueLoadingFallback}>
      <IssueView issueId={issueId} />
    </Suspense>
  )
}
