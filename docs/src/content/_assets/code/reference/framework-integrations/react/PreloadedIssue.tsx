import { Suspense, useCallback, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { useStoreRegistry } from '@livestore/react'

import { issueStoreOptions } from './issue.store.ts'
import { IssueView } from './IssueView.tsx'

const errorFallback = <div>Error loading issue</div>
const loadingFallback = <div>Loading issue...</div>

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

  const showIssueView = useCallback(() => {
    setShowIssue(true)
  }, [])

  return (
    <div>
      {showIssue === false ? (
        <button type="button" onMouseEnter={handleMouseEnter} onClick={showIssueView}>
          Show Issue
        </button>
      ) : (
        <ErrorBoundary fallback={errorFallback}>
          <Suspense fallback={loadingFallback}>
            <IssueView issueId={issueId} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
