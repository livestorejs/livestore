# Multi-Store Design Proposal (Per-Type Registry)

## Overview

This document proposes the API design for supporting multiple LiveStore instances in React applications. The design prioritizes simplicity, type safety, and React best practices while enabling both simple and complex use cases.

## Core API: `createStoreContext`

The foundation of the multi-store API is the `createStoreContext` function that creates a Provider component and a custom hook for accessing the store.

### Store Definition

```tsx
import { createStoreContext } from '@livestore/react'
import { workspaceSchema } from './schemas'
import { workspaceAdapter } from './adapters'

// createStoreContext returns a tuple: [Provider, useStore]
export const [WorkspaceStoreProvider, useWorkspaceStore] = createStoreContext({
  name: 'workspace',
  schema: workspaceSchema,
  adapter: workspaceAdapter, // Optional: can be overridden in Provider
})

export const [ProjectStoreProvider, useProjectStore] = createStoreContext({
  name: 'project',
  schema: projectSchema,
  adapter: projectAdapter,
})

export const [IssueStoreProvider, useIssueStore] = createStoreContext({
  name: 'issue',
  schema: issueSchema,
  adapter: issueAdapter,
})
```

### Return Type

```tsx
type DefineStoreReturn<TSchema extends LiveStoreSchema> = [
  // Provider component
  React.FC<StoreProviderProps<TSchema>>,
  // Hook for accessing the store
  (options?: UseStoreOptions) => Store<TSchema> & ReactAPI
]

interface UseStoreOptions {
  // For accessing a specific store instance
  storeId?: string
  // Other LiveStore options that can be overridden per-use
  syncPayload?: Schema.JsonValue
}
```

## Provider Component

The Provider component returned by `createStoreContext` is a custom component (not a raw Context.Provider) that handles store initialization and lifecycle.

### Provider Props

```tsx
interface StoreProviderProps<TSchema> {
  // Store instance identifier
  storeId?: string // Defaults to the store name
  
  // Override the default adapter
  adapter?: Adapter
  
  // Batch updates function (usually from react-dom)
  batchUpdates?: (fn: () => void) => void
  
  // Other LiveStore options
  disableDevtools?: boolean
  confirmUnsavedChanges?: boolean
  syncPayload?: Schema.JsonValue
  
  // Children are always rendered immediately
  children: React.ReactNode
}
```

### Key Behaviors

1. **Provider-Level Suspense**: `<WorkspaceStoreProvider>` (and friends) suspend until the underlying LiveStore instance reaches the `running` stage. Callers must wrap providers in `React.Suspense` to supply loading UIs.
2. **No Render Props**: Loading is handled solely through Suspense fallbacks; there are no `renderLoading` or `renderError` props.
3. **Error Boundaries**: Initialization errors are thrown so that React Error Boundaries can render recovery UIs.

## Store Access API

### Primary API: Custom Hooks

The hooks returned by `createStoreContext` are the primary way to access stores:

```tsx
function MyComponent() {
  // Access the nearest provider's store (most common case)
  const workspaceStore = useWorkspaceStore()
  const projectStore = useProjectStore()
  
  // Use store methods
  const tasks = projectStore.useQuery(tasksQuery)
  const workspace = workspaceStore.useQuery(workspaceQuery)
  
  // Commit events
  projectStore.commit(events.taskCreated({ title: 'New task' }))
  
  return <TaskList tasks={tasks} />
}
```

### Multi-Instance Access

For the rare case of accessing multiple instances of the same store type:

```tsx
function IssueComparison({ issueIds }: { issueIds: [string, string] }) {
  // Access specific store instances by storeId
  const issue1 = useIssueStore({ storeId: `issue-${issueIds[0]}` })
  const issue2 = useIssueStore({ storeId: `issue-${issueIds[1]}` })
  
  const data1 = issue1.useQuery(issueQuery)
  const data2 = issue2.useQuery(issueQuery)
  
  return <ComparisonView left={data1} right={data2} />
}
```

Note: When using `storeId` option, the hook will:
- Return the specific store instance if it exists
- Throw an error if no provider with that `storeId` has been mounted (or finished booting)
- Surface initialization failures via React error boundaries (providers throw on error)

## Store Instance API

Each store instance provides React-specific methods:

```tsx
interface StoreWithReactAPI<TSchema> extends Store<TSchema> {
  // React hook for queries (replaces useQuery hook)
  useQuery<T>(query: LiveQueryDef<T>): T
  
  // React hook for client documents
  useClientDocument(
    table: string,
    id: string,
    options?: ClientDocumentOptions
  ): ClientDocument
  
  // All existing Store methods (commit, query, etc.)
  ...Store<TSchema>
}
```

## Suspense Integration

Stores integrate with React Suspense by suspending at the provider boundary. Each `<XStoreProvider>` throws a promise until the underlying LiveStore instance reaches the `running` stage, so callers must wrap providers in `<Suspense>`:

```tsx
function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <WorkspaceStoreProvider>
          <ProjectStoreProvider>
            <AppContent />
          </ProjectStoreProvider>
      </WorkspaceStoreProvider>
    </Suspense>
  )
}

function AppContent() {
  // Providers guarantee the store is ready before children render
  const workspaceStore = useWorkspaceStore()
  const projectStore = useProjectStore()

  const tasks = projectStore.useQuery(tasksQuery)
  return <TaskList tasks={tasks} />
}
```

## Error Handling

Errors are handled through React Error Boundaries. No render props are provided - all error handling is done via boundaries:

```tsx
function App() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <Suspense fallback={<Loading />}>
        <WorkspaceStoreProvider>
          <ProjectStoreProvider>
            <AppContent />
          </ProjectStoreProvider>
        </WorkspaceStoreProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
```

## Implementation Considerations

### Why Not Pure `React.use()`?

While we initially considered using `React.use()` directly with Context objects, this approach has technical limitations:

1. **`React.use()` limitations**: It can accept either a Context OR a Promise, but not both behaviors in one resource
2. **Custom logic needed**: Store initialization, lifecycle management, and multi-instance support require custom logic
3. **Better DX**: Custom hooks provide better error messages and TypeScript inference

### Custom Provider Implementation

The Provider component is not a raw `Context.Provider` but a custom component that:
- Kicks off store loading on mount
- Manages store lifecycle
- Provides both default and instance-specific contexts
- Integrates with Suspense via promises

### Custom Hook Implementation

The hooks simply read the store once the provider resumes rendering. By the time `useWorkspaceStore()` runs, the provider has already suspended (if needed) and the store is fully initialized. Errors still propagate to error boundaries, preserving type safety and DX.

## Usage Examples

### Example 1: Simple Single Store

```tsx
// Define store
export const [AppStoreProvider, useAppStore] = createStoreContext({
  name: 'app',
  schema: appSchema,
  adapter: appAdapter,
})

// Use in app
function App() {
  return (
    <Suspense fallback={<Loading />}>
      <AppStoreProvider>
        <MainContent />
      </AppStoreProvider>
    </Suspense>
  )
}

function MainContent() {
  const appStore = useAppStore()
  const todos = appStore.useQuery(todosQuery)
  return <TodoList todos={todos} />
}
```

### Example 2: Dependent Stores

```tsx
function App() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspaceStoreProvider storeId="workspace-123">
        <WorkspaceApp />
      </WorkspaceStoreProvider>
    </Suspense>
  )
}

function WorkspaceApp() {
  // Access workspace to get project ID
  const workspaceStore = useWorkspaceStore()
  const currentProject = workspaceStore.useQuery(currentProjectQuery)
  
  // Set up project store with derived ID
  return (
    <Suspense fallback={<ProjectLoading />}>
      <ProjectStoreProvider storeId={`project-${currentProject.id}`}>
        <ProjectView />
      </ProjectStoreProvider>
    </Suspense>
  )
}
```

### Example 3: Concurrent Independent Stores

```tsx
function Dashboard() {
  return (
    // All stores load concurrently and each section can load independently 
    <div className="dashboard">
      <Suspense fallback={<WorkspaceLoading />}>
        <WorkspaceStoreProvider>
          <WorkspaceSection />
        </WorkspaceStoreProvider>
      </Suspense>
      
      <Suspense fallback={<SettingsLoading />}>
        <SettingsStoreProvider>
          <SettingsSection />
        </SettingsStoreProvider>
      </Suspense>

      <Suspense fallback={<NotificationsLoading />}>
        <NotificationsStoreProvider>
          <NotificationsSection />
        </NotificationsStoreProvider>
      </Suspense>
    </div>
  )
}
```

### Example 4: Multiple Instances

```tsx
function IssueBoard({ issueIds }: { issueIds: string[] }) {
  return (
    <Suspense fallback={<Loading />}>
      <div className="issue-grid">
        {issueIds.map(id => (
          <IssueStoreProvider key={id} storeId={`issue-${id}`}>
            <IssueCard issueId={id} />
          </IssueStoreProvider>
        ))}
      </div>
    </Suspense>
  )
}

function IssueCard({ issueId }: { issueId: string }) {
  // Access specific instance by storeId
  const issueStore = useIssueStore({ storeId: `issue-${issueId}` })

  const issue = issueStore.useQuery(issueQuery)
  return <Card>{issue.title}</Card>
}
```

## Migration from Current API

### Before (Single Store)
```tsx
<LiveStoreProvider 
  schema={schema} 
  adapter={adapter}
  batchUpdates={batchUpdates}
  renderLoading={(status) => <Loading status={status} />}
  renderError={(error) => <Error error={error} />}
>
  <App />
</LiveStoreProvider>

// In component
const { store } = useStore()
const todos = useQuery(todosQuery)
```

### After (Multi-Store)
```tsx
const [AppStoreProvider, useAppStore] = createStoreContext({
  name: 'app',
  schema: schema,
  adapter: adapter,
})

<ErrorBoundary fallback={<Error />}>
  <Suspense fallback={<Loading />}>
    <AppStoreProvider batchUpdates={batchUpdates}>
      <App />
    </AppStoreProvider>
  </Suspense>
</ErrorBoundary>

// In component
const appStore = useAppStore()
const todos = appStore.useQuery(todosQuery)
```

### Migration Benefits

1. **Familiar pattern**: Similar to current `useStore()` API
2. **Better error handling**: Leverages React's built-in error boundaries
3. **Better loading states**: Uses Suspense for more flexible loading UX
4. **Type safety**: Full inference without manual type annotations
5. **Multi-store ready**: Easy to add additional stores

## TypeScript Support

Full type inference is maintained throughout:

```tsx
// Schema defines types
const [ProjectStoreProvider, useProjectStore] = createStoreContext({
  name: 'project',
  schema: projectSchema, // Schema<{ todos: Todo[], users: User[] }>
})

// Types flow through to usage
const projectStore = useProjectStore()
const todos = projectStore.useQuery(todosQuery) // Type: Todo[]
projectStore.commit(events.todoCreated({ ... })) // Type-checked event
```
