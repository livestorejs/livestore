import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { userTables } from './user.schema.ts'
import { userStoreOptions } from './user.store.ts'
import { Workspace } from './Workspace.tsx'

// Component that displays all workspaces for a user
function WorkspaceListContent({ username }: { username: string }) {
  // Load the user store to get their workspace list
  const userStore = useStore(userStoreOptions(username))

  // Query all workspaces this user belongs to
  const workspaces = userStore.useQuery(queryDb(userTables.userWorkspace.select()))

  return (
    <div>
      <h1>My Workspaces</h1>
      {workspaces.length === 0 ? (
        <p>No workspaces yet</p>
      ) : (
        workspaces.map((w) => (
          <div key={w.workspaceId}>
            <Workspace workspaceId={w.workspaceId} />
          </div>
        ))
      )}
    </div>
  )
}

// Full workspace list with Suspense
export function WorkspaceList({ username }: { username: string }) {
  return (
    <ErrorBoundary fallback={<div>Error loading workspaces</div>}>
      <Suspense fallback={<div>Loading workspaces...</div>}>
        <WorkspaceListContent username={username} />
      </Suspense>
    </ErrorBoundary>
  )
}
