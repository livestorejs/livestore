# Multi-Store API Design Proposal

## Overview

This document proposes the API design for supporting multiple LiveStore instances in React applications. The design prioritizes simplicity, type safety, and React best practices while enabling both simple and complex use cases.

## Core API: `defineStore`

The foundation of the multi-store API is the `defineStore` function that creates a Provider component and a custom hook for accessing the store.

### Store Definition

```tsx
import { defineStore } from '@livestore/react'
import { workspaceSchema } from './schemas'
import { workspaceAdapter } from './adapters'

// defineStore returns a tuple: [Provider, useStore]
export const [WorkspaceStoreProvider, useWorkspaceStore] = defineStore({
  name: 'workspace',
  schema: workspaceSchema,
  adapter: workspaceAdapter, // Optional: can be overridden in Provider
})

export const [ProjectStoreProvider, useProjectStore] = defineStore({
  name: 'project',
  schema: projectSchema,
  adapter: projectAdapter,
})

export const [IssueStoreProvider, useIssueStore] = defineStore({
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

The Provider component returned by `defineStore` is a custom component (not a raw Context.Provider) that handles store initialization and lifecycle.

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

1. **Immediate Child Rendering**: Children render immediately, enabling concurrent store loading
2. **Suspense-Only Loading**: No render props - loading states handled via Suspense boundaries
3. **Error Boundaries**: Errors are thrown to be caught by Error Boundaries

## Store Access API

### Primary API: Custom Hooks

The hooks returned by `defineStore` are the primary way to access stores:

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
- Throw a promise if the store is still loading (triggering Suspense)
- Throw an error if the store failed to initialize
- Return null if no provider with that storeId exists

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

Stores integrate with React Suspense for loading states. The custom hooks internally use `React.use(Promise)` to trigger Suspense:

```tsx
function App() {
  return (
    <WorkspaceStoreProvider>
      <ProjectStoreProvider>
        {/* Suspense boundary handles loading */}
        <Suspense fallback={<LoadingSpinner />}>
          <AppContent />
        </Suspense>
      </ProjectStoreProvider>
    </WorkspaceStoreProvider>
  )
}

function AppContent() {
  // These hooks throw promises if stores are still loading
  const workspaceStore = useWorkspaceStore()
  const projectStore = useProjectStore()
  
  // Guaranteed to have loaded stores here
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
      <WorkspaceStoreProvider>
        <ProjectStoreProvider>
          <Suspense fallback={<Loading />}>
            <AppContent />
          </Suspense>
        </ProjectStoreProvider>
      </WorkspaceStoreProvider>
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

The hooks use `React.use(Promise)` internally to:
- Trigger Suspense when stores are loading
- Throw errors for Error Boundaries
- Provide type-safe store access

## Usage Examples

### Example 1: Simple Single Store

```tsx
// Define store
export const [AppStoreProvider, useAppStore] = defineStore({
  name: 'app',
  schema: appSchema,
  adapter: appAdapter,
})

// Use in app
function App() {
  return (
    <AppStoreProvider>
      <Suspense fallback={<Loading />}>
        <MainContent />
      </Suspense>
    </AppStoreProvider>
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
    <WorkspaceStoreProvider storeId="workspace-123">
      <Suspense fallback={<WorkspaceLoading />}>
        <WorkspaceApp />
      </Suspense>
    </WorkspaceStoreProvider>
  )
}

function WorkspaceApp() {
  // Access workspace to get project ID
  const workspaceStore = useWorkspaceStore()
  const currentProject = workspaceStore.useQuery(currentProjectQuery)
  
  // Set up project store with derived ID
  return (
    <ProjectStoreProvider storeId={`project-${currentProject.id}`}>
      <Suspense fallback={<ProjectLoading />}>
        <ProjectView />
      </Suspense>
    </ProjectStoreProvider>
  )
}
```

### Example 3: Concurrent Independent Stores

```tsx
function Dashboard() {
  return (
    // All stores load concurrently
    <WorkspaceStoreProvider>
      <SettingsStoreProvider>
        <NotificationsStoreProvider>
          {/* Each section can load independently */}
          <div className="dashboard">
            <Suspense fallback={<WorkspaceLoading />}>
              <WorkspaceSection />
            </Suspense>
            
            <Suspense fallback={<SettingsLoading />}>
              <SettingsSection />
            </Suspense>
            
            <Suspense fallback={<NotificationsLoading />}>
              <NotificationsSection />
            </Suspense>
          </div>
        </NotificationsStoreProvider>
      </SettingsStoreProvider>
    </WorkspaceStoreProvider>
  )
}
```

### Example 4: Multiple Instances

```tsx
function IssueBoard({ issueIds }: { issueIds: string[] }) {
  return (
    <>
      {/* Set up multiple issue store providers */}
      {issueIds.map(id => (
        <IssueStoreProvider key={id} storeId={`issue-${id}`} />
      ))}
      
      {/* Access them in child components */}
      <Suspense fallback={<Loading />}>
        <div className="issue-grid">
          {issueIds.map(id => (
            <IssueCard key={id} issueId={id} />
          ))}
        </div>
      </Suspense>
    </>
  )
}

function IssueCard({ issueId }: { issueId: string }) {
  // Access specific instance
  const issueStore = useIssueStore({ storeId: `issue-${issueId}` })
  
  if (!issueStore) {
    return <div>Issue not found</div>
  }
  
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
const [AppStoreProvider, useAppStore] = defineStore({
  name: 'app',
  schema: schema,
  adapter: adapter,
})

<ErrorBoundary fallback={<Error />}>
  <AppStoreProvider batchUpdates={batchUpdates}>
    <Suspense fallback={<Loading />}>
      <App />
    </Suspense>
  </AppStoreProvider>
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
const [ProjectStoreProvider, useProjectStore] = defineStore({
  name: 'project',
  schema: projectSchema, // Schema<{ todos: Todo[], users: User[] }>
})

// Types flow through to usage
const projectStore = useProjectStore()
const todos = projectStore.useQuery(todosQuery) // Type: Todo[]
projectStore.commit(events.todoCreated({ ... })) // Type-checked event
```