import { Suspense } from 'react'

import { queryDb } from '@livestore/livestore'

import { userTables } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'
import { Workspace } from './Workspace.tsx'

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
        <Suspense fallback={workspaceListLoadingFallback}>
          <ul>
            {workspaces.map((w) => (
              <li key={w.workspaceId}>
                <Workspace workspaceId={w.workspaceId} />
              </li>
            ))}
          </ul>
        </Suspense>
      )}
    </div>
  )
}
