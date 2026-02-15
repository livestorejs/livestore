import { StoreRegistryProvider } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { IssueView } from '@/components/IssueView.tsx'
import { WorkspaceView } from '@/components/WorkspaceView.tsx'

export const Route = createFileRoute('/independent')({
  component: IndependentDemoRoute,
})

const loadingWorkspaceFallback = <div className="loading">Loading workspace...</div>
const loadingIssueFallback = <div className="loading">Loading issue...</div>

const IndependentDemoRoute = () => {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <>
      <h2>Independent</h2>
      <em>Independent · Different Types · Separate Loading</em>
      <p>
        Demonstrates unrelated store types loading side by side. Each provider owns its Suspense boundary so loading and
        failure states stay isolated.
      </p>

      <div>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={loadingWorkspaceFallback}>
              <WorkspaceView />
            </Suspense>
          </ErrorBoundary>

          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={loadingIssueFallback}>
              <IssueView issueId="root-issue" />
            </Suspense>
          </ErrorBoundary>
        </StoreRegistryProvider>
      </div>
    </>
  )
}
