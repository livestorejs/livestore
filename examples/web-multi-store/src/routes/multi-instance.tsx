import { StoreRegistryProvider } from '@livestore/react/experimental'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { IssueView } from '@/components/IssueView.tsx'

const issueIds = ['issue-1', 'issue-2', 'issue-3'] as const

export const Route = createFileRoute('/multi-instance')({
  loader: ({ context }) => {
    if (!context.storeRegistry) {
      throw new Error('Multi-store registry is unavailable in the loader context.')
    }

    return null
  },
  component: MultiInstanceRoute,
})

function MultiInstanceRoute() {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <>
      <h2>Multi-Instance</h2>
      <em>Independent · Same Type · Shared Loading</em>
      <p>
        Demonstrates multiple instances of a single store type sharing one Suspense boundary. Each issue still owns an
        isolated store instance keyed by its <code>storeId</code>.
      </p>

      <div>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<div className="loading">Loading all issue stores...</div>}>
              {issueIds.map((id) => (
                <IssueView key={id} issueId={id} />
              ))}
            </Suspense>
          </ErrorBoundary>
        </StoreRegistryProvider>
      </div>
    </>
  )
}
