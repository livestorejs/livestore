import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { queryDb } from '@livestore/livestore'

import { userTables } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'
import { Workspace } from './Workspace.tsx'

export function WorkspaceList() {
  const userStore = useCurrentUserStore()

  // Query all workspaces this user belongs to
  const workspaces = userStore.useQuery(queryDb(userTables.userWorkspaces.select()))

  return (
    <div>
      <h1>My Workspaces</h1>
      {workspaces.length === 0 ? (
        <p>No workspaces yet</p>
      ) : (
        <ErrorBoundary fallback={<div>Error loading workspaces</div>}>
          <Suspense fallback={<div>Loading workspaces...</div>}>
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
