import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'

import { tables } from './issue.schema.ts'
import { issueStoreOptions } from './issue.store.ts'

const issueErrorFallback = <div>Error loading issue</div>
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

// Wrap with Suspense and ErrorBoundary for loading and error states
export const IssueViewWithSuspense = ({ issueId }: { issueId: string }) => {
  return (
    <ErrorBoundary fallback={issueErrorFallback}>
      <Suspense fallback={issueLoadingFallback}>
        <IssueView issueId={issueId} />
      </Suspense>
    </ErrorBoundary>
  )
}
