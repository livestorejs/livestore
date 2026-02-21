import { useStoreRegistry } from '@livestore/react'
import { Suspense, useCallback, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { IssueView } from './IssueView.tsx'
import { issueStoreOptions } from './issue.store.ts'

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
        <ErrorBoundary fallback={<div>Error loading issue</div>}>
          <Suspense fallback={<div>Loading issue...</div>}>
            <IssueView issueId={issueId} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
