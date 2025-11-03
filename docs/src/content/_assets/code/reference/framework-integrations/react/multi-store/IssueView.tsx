import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { tables } from './schema.ts'
import { issueStoreOptions } from './store.ts'

export function IssueView({ issueId }: { issueId: string }) {
  // useStore() suspends the component until the store is loaded
  // If the same store was already loaded, it returns immediately
  const issueStore = useStore(issueStoreOptions(issueId))

  // Query data from the store
  const [issue] = issueStore.useQuery(queryDb(tables.issue.select().where({ id: issueId })))

  if (!issue) return <div>Issue not found</div>

  return (
    <div>
      <h3>{issue.title}</h3>
      <p>Status: {issue.status}</p>
    </div>
  )
}

// Wrap with Suspense and ErrorBoundary for loading and error states
export function IssueViewWithSuspense({ issueId }: { issueId: string }) {
  return (
    <ErrorBoundary fallback={<div>Error loading issue</div>}>
      <Suspense fallback={<div>Loading issue...</div>}>
        <IssueView issueId={issueId} />
      </Suspense>
    </ErrorBoundary>
  )
}
