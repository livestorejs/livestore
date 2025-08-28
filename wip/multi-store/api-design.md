# Multi-Store API Design Proposal

## Overview

This document proposes the API design for supporting multiple LiveStore instances in React applications. The design prioritizes simplicity, type safety, and React best practices while enabling both simple and complex use cases.

## Core API: `defineStoreContext`

The foundation of the multi-store API is the `defineStoreContext` function that creates a typed store context.

### Store Context Definition

```tsx
import { defineStoreContext } from '@livestore/react'
import { workspaceSchema } from './schemas'
import { workspaceAdapter } from './adapters'

// Create a store context with schema and optional adapter
export const WorkspaceStoreContext = defineStoreContext({
  name: 'workspace',
  schema: workspaceSchema,
  adapter: workspaceAdapter, // Optional: can be overridden in Provider
})

export const ProjectStoreContext = defineStoreContext({
  name: 'project',
  schema: projectSchema,
  adapter: projectAdapter,
})

export const IssueStoreContext = defineStoreContext({
  name: 'issue',
  schema: issueSchema,
  adapter: issueAdapter,
})
```

### Return Type

```tsx
interface StoreContextDefinition<TSchema extends LiveStoreSchema> {
  // Provider component for this store
  Provider: React.FC<StoreProviderProps<TSchema>>
  
  // For accessing specific instances by storeId
  withStoreId: (storeId: string) => (Store<TSchema> & ReactAPI) | null
}
```

## Provider Component

Each store context includes a Provider component that sets up the store instance.

### Provider Props

```tsx
interface StoreProviderProps<TSchema> {
  // Store instance identifier
  storeId?: string // Defaults to the store name
  
  // Override the default adapter
  adapter?: Adapter
  
  // Batch updates function (usually from react-dom)
  batchUpdates?: (fn: () => void) => void
  
  // Render props for different states
  renderLoading?: (status: BootStatus) => React.ReactNode
  renderError?: (error: unknown) => React.ReactNode
  renderShutdown?: (cause: ShutdownCause) => React.ReactNode
  
  // Other LiveStore options
  disableDevtools?: boolean
  confirmUnsavedChanges?: boolean
  syncPayload?: Schema.JsonValue
  
  // Children are always rendered immediately
  children: React.ReactNode
}
```

### Key Behavior: Immediate Child Rendering

Unlike the current LiveStoreProvider, the new Provider **always renders children immediately**, enabling concurrent store loading:

```tsx
// These stores load CONCURRENTLY
<WorkspaceStoreContext.Provider>
  <ProjectStoreContext.Provider>
    <SettingsStoreContext.Provider>
      {/* All three stores start loading in parallel */}
      <App />
    </SettingsStoreContext.Provider>
  </ProjectStoreContext.Provider>
</WorkspaceStoreContext.Provider>
```

## Store Access API

### Primary API: `React.use()`

The primary way to access stores is through `React.use()` (currently equivalent to `useContext`):

```tsx
function MyComponent() {
  // Type-safe store access
  const workspaceStore = React.use(WorkspaceStoreContext)
  const projectStore = React.use(ProjectStoreContext)
  
  // Use store methods
  const tasks = projectStore.useQuery(tasksQuery)
  const workspace = workspaceStore.useQuery(workspaceQuery)
  
  // Commit events
  projectStore.commit(events.taskCreated({ title: 'New task' }))
  
  return <TaskList tasks={tasks} />
}
```

### Multi-Instance API: `withStoreId()`

For the rare case of accessing multiple instances of the same store type:

```tsx
function IssueComparison({ issueIds }: { issueIds: [string, string] }) {
  // Access specific store instances by ID
  const issue1 = IssueStoreContext.withStoreId(`issue-${issueIds[0]}`)
  const issue2 = IssueStoreContext.withStoreId(`issue-${issueIds[1]}`)
  
  if (!issue1 || !issue2) {
    return <div>Loading issues...</div>
  }
  
  const data1 = issue1.useQuery(issueQuery)
  const data2 = issue2.useQuery(issueQuery)
  
  return <ComparisonView left={data1} right={data2} />
}
```

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

Stores integrate with React Suspense for loading states:

```tsx
function App() {
  return (
    <WorkspaceStoreContext.Provider>
      <ProjectStoreContext.Provider>
        {/* Suspense boundary handles loading */}
        <Suspense fallback={<LoadingSpinner />}>
          <AppContent />
        </Suspense>
      </ProjectStoreContext.Provider>
    </WorkspaceStoreContext.Provider>
  )
}

function AppContent() {
  // These throw promises if stores are still loading
  const workspaceStore = React.use(WorkspaceStoreContext)
  const projectStore = React.use(ProjectStoreContext)
  
  // Guaranteed to have loaded stores here
  const tasks = projectStore.useQuery(tasksQuery)
  return <TaskList tasks={tasks} />
}
```

## Error Handling

Errors are handled through React Error Boundaries:

```tsx
function App() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <WorkspaceStoreContext.Provider>
        <ProjectStoreContext.Provider>
          <Suspense fallback={<Loading />}>
            <AppContent />
          </Suspense>
        </ProjectStoreContext.Provider>
      </WorkspaceStoreContext.Provider>
    </ErrorBoundary>
  )
}
```

## Usage Examples

### Example 1: Simple Single Store

```tsx
// Define store context
export const AppStoreContext = defineStoreContext({
  name: 'app',
  schema: appSchema,
  adapter: appAdapter,
})

// Use in app
function App() {
  return (
    <AppStoreContext.Provider>
      <Suspense fallback={<Loading />}>
        <MainContent />
      </Suspense>
    </AppStoreContext.Provider>
  )
}

function MainContent() {
  const appStore = React.use(AppStoreContext)
  const todos = appStore.useQuery(todosQuery)
  return <TodoList todos={todos} />
}
```

### Example 2: Dependent Stores

```tsx
function App() {
  return (
    <WorkspaceStoreContext.Provider storeId="workspace-123">
      <Suspense fallback={<WorkspaceLoading />}>
        <WorkspaceApp />
      </Suspense>
    </WorkspaceStoreContext.Provider>
  )
}

function WorkspaceApp() {
  // Access workspace to get project ID
  const workspaceStore = React.use(WorkspaceStoreContext)
  const currentProject = workspaceStore.useQuery(currentProjectQuery)
  
  // Set up project store with derived ID
  return (
    <ProjectStoreContext.Provider storeId={`project-${currentProject.id}`}>
      <Suspense fallback={<ProjectLoading />}>
        <ProjectView />
      </Suspense>
    </ProjectStoreContext.Provider>
  )
}
```

### Example 3: Concurrent Independent Stores

```tsx
function Dashboard() {
  return (
    // All stores load concurrently
    <WorkspaceStoreContext.Provider>
      <SettingsStoreContext.Provider>
        <NotificationsStoreContext.Provider>
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
        </NotificationsStoreContext.Provider>
      </SettingsStoreContext.Provider>
    </WorkspaceStoreContext.Provider>
  )
}
```

### Example 4: Multiple Instances

```tsx
function IssueBoard({ issueIds }: { issueIds: string[] }) {
  return (
    <>
      {/* Set up multiple issue stores */}
      {issueIds.map(id => (
        <IssueStoreContext.Provider key={id} storeId={`issue-${id}`} />
      ))}
      
      {/* Access them by ID */}
      <div className="issue-grid">
        {issueIds.map(id => (
          <IssueCard key={id} issueId={id} />
        ))}
      </div>
    </>
  )
}

function IssueCard({ issueId }: { issueId: string }) {
  // Access specific instance
  const issueStore = IssueStoreContext.withStoreId(`issue-${issueId}`)
  
  if (!issueStore) {
    return <div>Loading issue...</div>
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
>
  <App />
</LiveStoreProvider>

// In component
const { store } = useStore()
const todos = useQuery(todosQuery)
```

### After (Multi-Store)
```tsx
const AppStoreContext = defineStoreContext({
  name: 'app',
  schema: schema,
  adapter: adapter,
})

<AppStoreContext.Provider batchUpdates={batchUpdates}>
  <App />
</AppStoreContext.Provider>

// In component
const appStore = React.use(AppStoreContext)
const todos = appStore.useQuery(todosQuery)
```

## TypeScript Support

Full type inference is maintained throughout:

```tsx
// Schema defines types
const ProjectStoreContext = defineStoreContext({
  name: 'project',
  schema: projectSchema, // Schema<{ todos: Todo[], users: User[] }>
})

// Types flow through to usage
const projectStore = React.use(ProjectStoreContext)
const todos = projectStore.useQuery(todosQuery) // Type: Todo[]
projectStore.commit(events.todoCreated({ ... })) // Type-checked event
```