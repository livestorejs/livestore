import { queryDb } from '@livestore/livestore'
import { useStore, useStoreRegistry } from '@livestore/react'
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

  const addIssue = () => {
    workspaceStore.commit(
      workspaceEvents.issueCreated({
        id: Date.now().toString(),
        workspaceId: workspace.id,
        title: `Issue ${issueIds.length + 1}`,
        createdAt: new Date(),
      }),
    )
  }

  const [isPreloadedIssueShown, setisPreloadedIssueShown] = useState(false)

  const storeRegistry = useStoreRegistry()
  const preloadIssue = (issueId: string) =>
    storeRegistry.preload({
      ...issueStoreOptions(issueId),
      gcTime: 5_000,
    })

  return (
    <div className="container">
      <h2>{workspace.name}</h2>
      <dl>
        <dt>ID:</dt>
        <dd>{workspace.id}</dd>
        <dt>Store ID:</dt>
        <dd>{workspaceStore.storeId}</dd>
      </dl>
      <div style={{ marginBottom: 20 }}>
        <button type="button" onClick={addIssue}>
          Create Issue
        </button>
      </div>

      <h3>Recent Issues ({issueIds.length})</h3>
      <ul>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div className="loading">Loading issue stores...</div>}>
            {issueIds.map((id) => (
              <IssueView key={id} issueId={id} />
            ))}
          </Suspense>
        </ErrorBoundary>
      </ul>

      <h3>Preloaded Issue (will preload on mouse enter)</h3>
      {!isPreloadedIssueShown ? (
        <button
          type="button"
          onMouseEnter={() => preloadIssue('preloaded-issue')}
          onClick={() => setisPreloadedIssueShown(true)}
        >
          Show
        </button>
      ) : (
        <IssueView issueId={'preloaded-issue'} />
      )}
    </div>
  )
}
