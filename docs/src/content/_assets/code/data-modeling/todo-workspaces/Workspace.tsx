import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { userTables } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'
import { workspaceEvents, workspaceTables } from './workspace.schema.ts'
import { workspaceStoreOptions } from './workspace.store.ts'

// Component that accesses a specific workspace store
export function Workspace({ workspaceId }: { workspaceId: string }) {
  const userStore = useCurrentUserStore()
  const workspaceStore = useStore(workspaceStoreOptions(workspaceId))

  // Check if this workspace exists in user's workspace list
  const [knownWorkspace] = userStore.useQuery(queryDb(userTables.userWorkspaces.select().where({ workspaceId })))

  // Query workspace data
  const [workspace] = workspaceStore.useQuery(queryDb(workspaceTables.workspace.select().limit(1)))
  const todos = workspaceStore.useQuery(queryDb(workspaceTables.todos.select()))

  // Workspace not in user's list → truly doesn't exist
  if (!knownWorkspace) return <div>Workspace not found</div>

  // Workspace is in user's list but not yet initialized → loading state
  if (!workspace) return <div>Loading workspace...</div>

  const addTodo = (text: string) => {
    workspaceStore.commit(
      workspaceEvents.todoAdded({
        todoId: `todo-${Date.now()}`,
        text,
      }),
    )
  }

  return (
    <div>
      <h2>{workspace.name}</h2>
      <p>Created by: {workspace.createdByUsername}</p>
      <p>Store ID: {workspaceStore.storeId}</p>

      <h3>Todos ({todos.length})</h3>
      <ul>
        {todos.map((todo) => (
          <li key={todo.todoId}>
            {todo.text} {todo.completed ? '✓' : ''}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => addTodo('New todo')}>
        Add Todo
      </button>
    </div>
  )
}
