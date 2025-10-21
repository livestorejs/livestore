import { queryDb } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react/experimental'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { workspaceStoreOptions } from '@/stores/workspace'
import { workspaceEvents, workspaceTables } from '@/stores/workspace/schema.ts'

export const Route = createFileRoute('/')({
  loader: ({ context }) => {
    context.storeRegistry.preload(workspaceStoreOptions)
  },
  component: SingleRoute,
})

function SingleRoute() {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <>
      <h2>Single</h2>
      <em>One Type · One Instance</em>
      <p>Demonstrates a single store instance with suspense and error boundaries.</p>

      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading store…</div>}>
            <Workspace />
          </Suspense>
        </ErrorBoundary>
      </StoreRegistryProvider>
    </>
  )
}

function Workspace() {
  const workspaceStore = useStore(workspaceStoreOptions)
  const [workspace] = workspaceStore.useQuery(queryDb(workspaceTables.workspaces.select().limit(1)))
  const issues = workspaceStore.useQuery(
    queryDb(workspaceTables.issues.where({ workspaceId: workspace.id }).orderBy('createdAt', 'desc')),
  )

  const addIssue = () => {
    workspaceStore.commit(
      workspaceEvents.issueCreated({
        id: Date.now().toString(),
        workspaceId: workspace.id,
        title: `Issue ${issues.length + 1}`,
        createdAt: new Date(),
      }),
    )
  }

  return (
    <div>
      <h3>{workspace.name}</h3>
      <dl>
        <dt>ID:</dt>
        <dd>{workspace.id}</dd>
        <dt>Store ID:</dt>
        <dd>{workspaceStore.storeId}</dd>
      </dl>
      <p>
        <button type="button" onClick={addIssue}>
          Create Issue
        </button>
      </p>
      <h3>Issues ({issues.length})</h3>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id}>ID: {issue.id}</li>
        ))}
      </ul>
    </div>
  )
}
