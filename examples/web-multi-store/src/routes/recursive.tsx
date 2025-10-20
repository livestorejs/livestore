import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { IssueView } from '@/components/IssueView.tsx'

export const Route = createFileRoute('/recursive')({
  ssr: false,
  loader: ({ context }) => {
    if (!context.storeRegistry) {
      throw new Error('Multi-store registry is unavailable in the loader context.')
    }

    return null
  },
  component: RecursiveDemoRoute,
})

function RecursiveDemoRoute() {
  return (
    <section className="container">
      <h2>Recursive</h2>
      <em>Dependent · Same Type · Shared Loading</em>
      <p>
        Demonstrates a store tree where each level reuses the same context (Issue → Sub-Issue). All instances share a
        Suspense boundary while remaining individually addressable by <code>storeId</code>.
      </p>

      <div className="grid">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading all issue stores...</div>}>
            <IssueView issueId="root-issue" />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  )
}
