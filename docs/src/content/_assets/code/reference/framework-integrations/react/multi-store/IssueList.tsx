import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { tables } from './schema.ts'
import { issueStoreOptions } from './store.ts'

function IssueCard({ issueId }: { issueId: string }) {
  // Each call to useStore with a different storeId loads/gets a separate store instance
  const issueStore = useStore(issueStoreOptions(issueId))
  const [issue] = issueStore.useQuery(queryDb(tables.issue.select().where({ id: issueId })))

  if (!issue) return <div>Issue not found</div>

  return (
    <div>
      <h4>{issue.title}</h4>
      <p>Store ID: {issueStore.storeId}</p>
      <p>Status: {issue.status}</p>
    </div>
  )
}

// Component that displays multiple independent store instances with shared error and loading states
export function IssueList() {
  const issueIds = ['issue-1', 'issue-2', 'issue-3']

  return (
    <div>
      <h3>Issues</h3>
      <ErrorBoundary fallback={<div>Error loading issues</div>}>
        <Suspense fallback={<div>Loading issues...</div>}>
          {issueIds.map((id) => (
            <IssueCard key={id} issueId={id} />
          ))}
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
