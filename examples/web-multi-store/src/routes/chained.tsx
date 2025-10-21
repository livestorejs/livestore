import { StoreRegistryProvider } from '@livestore/react/experimental'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { WorkspaceView } from '@/components/WorkspaceView.tsx'

export const Route = createFileRoute('/chained')({
  component: ChainedDemoRoute,
})

function ChainedDemoRoute() {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <>
      <h2>Chained</h2>
      <em>Dependent · Different Types · Separate Loading</em>
      <p>
        Demonstrates parent→child store composition (Workspace → Issue). The inner store waits on data from the outer
        provider but still suspends independently to keep loading isolated.
      </p>

      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading workspace store...</div>}>
            <WorkspaceView />
          </Suspense>
        </ErrorBoundary>
      </StoreRegistryProvider>
    </>
  )
}
