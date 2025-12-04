import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { workspaceEvents, workspaceTables } from './workspace.schema.ts'
import { workspaceStoreOptions } from './workspace.store.ts'

// Component that accesses a specific workspace store
function WorkspaceContent({ workspaceId }: { workspaceId: string }) {
  // Load the workspace store for this specific workspace
  const workspaceStore = useStore(workspaceStoreOptions(workspaceId))

  // Query workspace data
  const [workspace] = workspaceStore.useQuery(queryDb(workspaceTables.workspace.select().limit(1)))
  const todos = workspaceStore.useQuery(queryDb(workspaceTables.todo.select()))

  if (!workspace) return <div>Workspace not found</div>

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

// Workspace component with Suspense and ErrorBoundary
export function Workspace({ workspaceId }: { workspaceId: string }) {
  return (
    <ErrorBoundary fallback={<div>Error loading workspace</div>}>
      <Suspense fallback={<div>Loading workspace...</div>}>
        <WorkspaceContent workspaceId={workspaceId} />
      </Suspense>
    </ErrorBoundary>
  )
}
