import { queryDb } from '@livestore/livestore'
import { useStore, useStoreRegistry } from '@livestore/react/experimental'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { issueStoreOptions } from '@/stores/issue'
import { issueEvents, issueTables } from '@/stores/issue/schema.ts'
import { workspaceStoreOptions } from '@/stores/workspace'
import { workspaceEvents, workspaceTables } from '@/stores/workspace/schema.ts'

export const Route = createFileRoute('/full')({
  loader: ({ context }) => {
    context.storeRegistry.preload(workspaceStoreOptions)
  },
  component: FullDemoRoute,
})

function FullDemoRoute() {
  return (
    <section className="container">
      <h2>Full Demo</h2>
      <p>Minimal demo covering query hooks, committing events, preloading, and recursive store traversal.</p>

      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Suspense fallback={<div className="loading">Loading workspace…</div>}>
          <WorkspacePanel />
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}

function WorkspacePanel() {
  const workspaceStore = useStore(workspaceStoreOptions)

  const [workspace] = workspaceStore.useQuery(queryDb(workspaceTables.workspaces.select().limit(1)))
  const issueIds = workspaceStore.useQuery(
    queryDb(
      workspaceTables.issues.select('id').where({ workspaceId: workspace.id }).orderBy('createdAt', 'desc').limit(5),
    ),
  )

  const createIssue = () => {
    workspaceStore.commit(
      workspaceEvents.issueCreated({
        id: (issueIds.length + 1).toString(),
        workspaceId: workspace.id,
        title: `Issue ${issueIds.length + 1}`,
        createdAt: new Date(),
      }),
    )
  }

  const [selectedIssueId, setSelectedIssueId] = useState<string>()
  const selectIssue = (issueId: string) => {
    setSelectedIssueId(issueId)
  }

  const [preloadingIssueId, setPreloadingIssueId] = useState<string>()
  const storeRegistry = useStoreRegistry()
  const preloadIssue = (issueId: string) => {
    setPreloadingIssueId(issueId)
    storeRegistry
      .preload({
        ...issueStoreOptions(issueId),
        gcTime: 5_000,
      })
      .then(() => setPreloadingIssueId(undefined))
  }

  return (
    <div>
      <div>
        <h3>Workspace</h3>
        <p>
          <strong>{workspace.name}</strong> (store ID: {workspaceStore.storeId})
        </p>
        <button type="button" onClick={createIssue}>
          Create Issue
        </button>
      </div>

      <div>
        <h3>Issues</h3>
        {issueIds.length === 0 ? (
          <p>No issues yet. Create one above.</p>
        ) : (
          <ul>
            {issueIds.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => selectIssue(id)} onMouseEnter={() => preloadIssue(id)}>
                  Select {id}
                </button>
              </li>
            ))}
          </ul>
        )}
        {preloadingIssueId && <p className="loading">Preloading issue {preloadingIssueId}…</p>}
      </div>

      <div>
        <h3>Selected Issue</h3>
        {selectedIssueId ? (
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<div className="loading">Loading issue…</div>}>
              <IssuePanel issueId={selectedIssueId} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <p>No issue selected.</p>
        )}
      </div>
    </div>
  )
}

function IssuePanel({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreOptions(issueId))
  const [issue] = issueStore.useQuery(queryDb(issueTables.issue.select().limit(1)))

  const toggleStatus = () => {
    issueStore.commit(
      issueEvents.issueStatusChanged({ id: issue.id, status: issue.status === 'done' ? 'todo' : 'done' }),
    )
  }

  return (
    <>
      <p>
        <strong>{issue.title}</strong> (store ID: {issueStore.storeId})
      </p>
      <p>Status: {issue.status}</p>
      <button type="button" onClick={toggleStatus}>
        Toggle status
      </button>
      {issue.childIssueIds.length > 0 && (
        <div>
          <h4>Sub-issues</h4>
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<div className="loading">Loading sub-issues…</div>}>
              <ul>
                {issue.childIssueIds.map((id) => (
                  <li key={id}>
                    <IssuePanel issueId={id} />
                  </li>
                ))}
              </ul>
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </>
  )
}
