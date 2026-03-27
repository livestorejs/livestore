import { Suspense, useCallback, useState } from 'react'

import { useStoreRegistry } from '@livestore/react'

import { issueStoreOptions } from './issue.store.ts'
import { IssueView } from './IssueView.tsx'

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
        <Suspense fallback={preloadedIssueLoadingFallback}>
          <IssueView issueId={issueId} />
        </Suspense>
      )}
    </div>
  )
}
