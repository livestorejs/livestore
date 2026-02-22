import { useStoreRegistry } from '@livestore/react'
import { Suspense, useCallback, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { IssueView } from './IssueView.tsx'
import { issueStoreOptions } from './issue.store.ts'

const preloadedIssueErrorFallback = <div>Error loading issue</div>
const preloadedIssueLoadingFallback = <div>Loading issue...</div>

export const PreloadedIssue = ({ issueId }: { issueId: string }) => {
  const [showIssue, setShowIssue] = useState(false)
  const storeRegistry = useStoreRegistry()

  // Preload the store when the user hovers (before they click)
  const handleMouseEnter = useCallback(() => {
    storeRegistry.preload({
      ...issueStoreOptions(issueId),
      unusedCacheTime: 10_000, // Optionally override options
    })
  }, [issueId, storeRegistry])

  const handleClick = useCallback(() => {
    setShowIssue(true)
  }, [])

  return (
    <div>
      {showIssue == null ? (
        <button type="button" onMouseEnter={handleMouseEnter} onClick={handleClick}>
          Show Issue
        </button>
      ) : (
        <ErrorBoundary fallback={preloadedIssueErrorFallback}>
          <Suspense fallback={preloadedIssueLoadingFallback}>
            <IssueView issueId={issueId} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
