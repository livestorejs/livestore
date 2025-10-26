import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { issueStoreOptions } from '@/stores/issue'
import { issueEvents, issueTables } from '../stores/issue/schema.ts'

export function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreOptions(issueId)) // Will suspend component if the store is not yet loaded
  const [issue] = issueStore.useQuery(queryDb(issueTables.issue.select().limit(1)))

  const toggleStatus = () =>
    issueStore.commit(
      issueEvents.issueStatusChanged({
        id: issue.id,
        status: issue.status === 'done' ? 'todo' : 'done',
      }),
    )

  return (
    <div>
      <h4>{issue.title}</h4>
      <dl>
        <dt>ID:</dt>
        <dd>{issue.id}</dd>
        <dt>Store ID:</dt>
        <dd>{issueStore.storeId}</dd>
        <dt>Status:</dt>
        <dd>{issue.status}</dd>
      </dl>
      <p>
        <button type="button" onClick={toggleStatus}>
          Toggle Status
        </button>
      </p>

      {issue.childIssueIds.length > 0 && (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading sub-issues...</div>}>
            <ul>
              {issue.childIssueIds.map((id) => (
                <li key={id}>
                  <IssueView issueId={id} />
                </li>
              ))}
            </ul>
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
