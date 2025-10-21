import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { IssueView } from '@/components/IssueView.tsx'
import { WorkspaceView } from '@/components/WorkspaceView.tsx'

export const Route = createFileRoute('/independent')({
  component: IndependentDemoRoute,
})

function IndependentDemoRoute() {
  return (
    <section className="container">
      <h2>Independent</h2>
      <em>Independent · Different Types · Separate Loading</em>
      <p>
        Demonstrates unrelated store types loading side by side. Each provider owns its Suspense boundary so loading and
        failure states stay isolated.
      </p>

      <div className="grid">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading workspace...</div>}>
            <WorkspaceView />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading issue...</div>}>
            <IssueView issueId="root-issue" />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  )
}
