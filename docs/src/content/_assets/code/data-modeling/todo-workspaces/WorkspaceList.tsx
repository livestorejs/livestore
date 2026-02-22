import { queryDb } from '@livestore/livestore'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { userTables } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'
import { Workspace } from './Workspace.tsx'

const workspaceListErrorFallback = <div>Error loading workspaces</div>
const workspaceListLoadingFallback = <div>Loading workspaces...</div>

export const WorkspaceList = () => {
  const userStore = useCurrentUserStore()

  // Query all workspaces this user belongs to
  const workspaces = userStore.useQuery(queryDb(userTables.userWorkspaces.select()))

  return (
    <div>
      <h1>My Workspaces</h1>
      {workspaces.length === 0 ? (
        <p>No workspaces yet</p>
      ) : (
        <ErrorBoundary fallback={workspaceListErrorFallback}>
          <Suspense fallback={workspaceListLoadingFallback}>
            <ul>
              {workspaces.map((w) => (
                <li key={w.workspaceId}>
                  <Workspace workspaceId={w.workspaceId} />
                </li>
              ))}
            </ul>
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
