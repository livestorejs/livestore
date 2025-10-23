import { queryDb } from '@livestore/livestore'
import { useStore, useStoreRegistry } from '@livestore/react/experimental'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import { issueStoreOptions } from '@/stores/issue'
import { workspaceStoreOptions } from '@/stores/workspace'
import { workspaceEvents, workspaceTables } from '../stores/workspace/schema.ts'
import { IssueView } from './IssueView.tsx'

export function WorkspaceView() {
  const workspaceStore = useStore(workspaceStoreOptions)

  const [workspace] = workspaceStore.useQuery(queryDb(workspaceTables.workspaces.select().limit(1)))
  const issueIds = workspaceStore.useQuery(
    queryDb(
      workspaceTables.issues.select('id').where({ workspaceId: workspace.id }).orderBy('createdAt', 'desc').limit(5),
    ),
  )

  const addIssue = () =>
    workspaceStore.commit(
      workspaceEvents.issueCreated({
        id: Date.now().toString(),
        workspaceId: workspace.id,
        title: `Issue ${issueIds.length + 1}`,
        createdAt: new Date(),
      }),
    )

  const [isPreloadedIssueShown, setIsPreloadedIssueShown] = useState(false)
  const storeRegistry = useStoreRegistry()
  const preloadIssue = (issueId: string) =>
    storeRegistry.preload({
      ...issueStoreOptions(issueId),
      gcTime: 10_000,
    })

  return (
    <div>
      <h3>{workspace.name}</h3>
      <dl>
        <dt>ID:</dt>
        <dd>{workspace.id}</dd>
        <dt>Store ID:</dt>
        <dd>{workspaceStore.storeId}</dd>
      </dl>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div>
          <h4>Recent Issues ({issueIds.length})</h4>
          <p>
            <button type="button" onClick={addIssue}>
              Create Issue
            </button>
          </p>
          <ul>
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <Suspense fallback={<div className="loading">Loading issue stores...</div>}>
                {issueIds.map((id) => (
                  <IssueView key={id} issueId={id} />
                ))}
              </Suspense>
            </ErrorBoundary>
          </ul>
        </div>

        <div>
          <h4>Preload Issue</h4>
          <em>Preload by hovering over the button.</em>
          <div>
            {!isPreloadedIssueShown ? (
              <p>
                <button
                  type="button"
                  onMouseEnter={() => preloadIssue('preloaded-issue')}
                  onClick={() => setIsPreloadedIssueShown(true)}
                >
                  Show
                </button>
              </p>
            ) : (
              <ErrorBoundary FallbackComponent={ErrorFallback}>
                <Suspense fallback={<div className="loading">Loading issue store...</div>}>
                  <IssueView issueId="preloaded-issue" />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
