# Multi-Store Design Proposal (Global Registry + Universal Hook)

This document proposes the API design for supporting multiple LiveStore instances in React applications. The design prioritizes simplicity, type safety, and React best practices while enabling both simple and complex use cases.

## API Overview

[COMPLETE]

### Store Definition

We introduce a `defineStore` function to create store definitions. A store definition is a blueprint for creating store instances of a specific schema.

To define a store, you provide:
- A unique name for the store type (e.g., "workspace", "issue").
- A schema that describes the data structure.
- An adapter for persistence and synchronization.

A store definition can then be used to create multiple store instances, each identified by a unique `storeId`. `storeId` can be optionally provided when creating a store instance; if not provided, it defaults to the store definition name. The `storeId` must be globally unique to avoid collisions with other store instances.

```tsx
// src/stores/workspace/index.ts
import { defineStore } from '@livestore/livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'

import { workspaceSchema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const workspaceStoreDef = defineStore({
  name: 'workspace',
  schema: workspaceSchema,
  adapter,
})
```

```ts
// src/stores/issue/index.ts
import { defineStore } from '@livestore/livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { issueSchema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
})
```

#### Types

```ts
type CreateStoreParams = {
  storeId?: string
  syncPayload?: Schema.JsonValue
}

type StoreDefinition<TSchema extends LiveStoreSchema> = {
  name: string
  schema: TSchema
  create(params: CreateStoreParams): Promise<Store<TSchema>>
}
```

### React Bindings

#### Store Registry

One registry for the entire app to manage all store instances of any type.

```tsx
// src/App.tsx
import { Suspense } from 'react'
import { StoreRegistryProvider } from '@livestore/react'
import MainContent from './MainContent.tsx'

export default function App() {
  return (
    <StoreRegistryProvider>
      <Suspense fallback={<div>Loading...</div>}>
        <MainContent />
      </Suspense>
    </StoreRegistryProvider>
  )
}
```

#### Store Hook

```ts
import { useStore } from '@livestore/react'

// ... store definition code from above ...

export function WorkspaceView() {
  const workspaceStore = useStore(workspaceStoreDef)
  const workspace = workspaceStore.useQuery(workspaceQuery)
  return <div>Workspace: {workspace.name}</div>
}

export function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreDef, { storeId: issueId })
  const issue = issueStore.useQuery(issueQuery(issueId))
  return <div>Issue: {issue.title}</div>
}
```


##### Types

```ts
type UseStore = <TSchema extends LiveStoreSchema>(
  def: StoreDefinition<TSchema>,
  params?: CreateStoreParams
) => Store<TSchema>

type PreloadStore = <TSchema extends LiveStoreSchema>(
  def: StoreDefinition<TSchema>,
  params?: CreateStoreParams,
  registryOverride?: StoreRegistry
) => Promise<Store<TSchema>>
```

## Usage Examples

### Single Store Instance

Same as before, but compatible with Suspense and Error Boundaries.

```tsx
function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load app</div>}>
      <LiveStoreProvider
        schema={schema}
        adapter={adapter}
        batchUpdates={batchUpdates}
      >
        <Suspense fallback={<div>Loading app...</div>}>
          <MainContent />
        </Suspense>
      </LiveStoreProvider>
    </ErrorBoundary>
  )
}

function MainContent() {
  const appStore = useStore(appStoreDef) // Suspends the component until the store is ready
  const issues = appStore.useQuery(issuesQuery)
  return <IssueList issues={issues} />
}
```

### Independent Store Instances

```tsx
function App() {
  return (
    <StoreRegistryProvider>
      <MainContent />
    </StoreRegistryProvider>
  )
}

function MainContent() {
  return (
    <>
      <ErrorBoundary fallback={<div>Failed to load workspace</div>}>
        <Suspense fallback={<div className="loading">Loading workspace...</div>}>
          <WorkspaceView />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<div>Failed to load issue</div>}>
        <Suspense fallback={<div className="loading">Loading issue...</div>}>
          <IssueView issueId="issue-A" />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

function WorkspaceView() {
  const workspaceStore = useStore(workspaceStoreDef) // Defaults to storeId = workspaceStoreDef.name
  const workspace = workspaceStore.useQuery(workspaceQuery)
  return <div>Workspace: {workspace.name}</div>
}

function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreDef, { storeId: issueId })
  const issue = issueStore.useQuery(issueQuery(issueId))
  return <div>Issue: {issue.title}</div>
}
```

### Dependent Store Instances

```tsx
function App() {
  return (
    <StoreRegistryProvider>
      <MainContent/>
    </StoreRegistryProvider>
  )
}

function MainContent() {
  return (
    <ErrorBoundary fallback={<div>Failed to load workspace</div>}>
      <Suspense fallback={<div>Loading workspace...</div>}>
        <WorkspaceView />
      </Suspense>
    </ErrorBoundary>
  )
}

function WorkspaceView() {
  const workspaceStore = useStore(workspaceStoreDef)
  const workspace = workspaceStore.useQuery(workspaceQuery)

  return (
    <div>
      <h1>Workspace: {workspace.name}</h1>
      <ErrorBoundary fallback={<div>Failed to load issue list</div>}>
        <Suspense fallback={<div>Loading issue list...</div>}>
          {workspace.issueIds.map((issueId) => (
            <IssueView key={issueId} issueId={issueId} />
          ))}
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreDef, { storeId: issueId })
  const issue = issueStore.useQuery(issueQuery(issueId))

  return (
    <div>
      <h2>Issue: {issue.title}</h2>
      <div>
        <p>Child Issues:</p>
        <ErrorBoundary fallback={<div>Failed to load issue list</div>}>
          <Suspense fallback={<div>Loading issue list...</div>}>
            {issue.childIssueIds.map((id) => (
              <IssueView key={id} issueId={id} />
            ))}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
```

### Store Preloading

```tsx
// app/storeRegistry.ts
import { StoreRegistry } from '@livestore/react'

export const registry = new StoreRegistry()

// routes/workspaces.$workspaceId.tsx
import { createFileRoute } from '@tanstack/react-router'
import { preloadStore, useStore } from '@livestore/react'
import { workspaceStoreDef } from '../stores/workspace'
import { registry } from '../app/storeRegistry'

export const Route = createFileRoute('/workspaces/$workspaceId')({
  loader: async ({ params }) => {
    await preloadStore(workspaceStoreDef, { storeId: params.workspaceId }, registry)
    return null
  },
  component: WorkspaceRouteComponent,
})

function WorkspaceRouteComponent() {
  const { workspaceId } = Route.useParams()
  const store = useStore(workspaceStoreDef, { storeId: workspaceId })
  const workspace = store.useQuery(workspaceQuery(workspaceId))
  return <div>{workspace.name}</div>
}

// app/App.tsx
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StoreRegistryProvider } from '@livestore/react'
import { routeTree } from './routeTree'
import { registry } from './storeRegistry'

const router = createRouter({ routeTree })

export default function App() {
  return (
    <StoreRegistryProvider registry={registry}>
      <RouterProvider router={router} />
    </StoreRegistryProvider>
  )
}
```

## Implementation


```tsx
// --- New Types ---
type CreateStoreParams = {
  storeId?: string
  syncPayload?: Schema.JsonValue
}

type StoreDefinition<TSchema extends LiveStoreSchema> = {
  name: string
  schema: TSchema
  create(params: CreateStoreParams): Promise<Store<TSchema>>
}


// --- Registry caches create() results as Thenables (suspense-friendly) ---
export class StoreRegistry {
  private storePromises = new Map<string, Promise<Store>>()
  private storeInstances = new Map<string, Store>()
  private owners = new Map<string, StoreDefinition<any>>()

  get<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    params: CreateStoreParams = {}
  ): Promise<Store<TSchema>> {
    // Use store definition name as default storeId if not provided
    // This allows simple use cases to avoid specifying storeId
    const storeId = params.storeId ?? def.name
    
    // Ensure the storeId is owned by the same store definition
    // This prevents accidental collisions between different store types
    // e.g., "workspace" storeId used for an "issue" store definition
    const owner = this.owners.get(storeId)
    if (owner && owner !== def) {
      throw new Error(
        `storeId "${storeId}" already belongs to "${owner.name}", not "${def.name}".`
      )
    }
    
    let storePromise = this.storePromises.get(storeId)
    
    // Create the store instance if it doesn't exist
    if (!storePromise) {
      storePromise = def.create({ ...params, storeId })
        .then((store) => {
          // Cache the fully created store instance for future reference
          this.storeInstances.set(storeId, store)
          return store
        })
      this.storePromises.set(storeId, storePromise)
      this.owners.set(storeId, def)
    }
    
    return storePromise
  }

  has = (id: string) => this.storePromises.has(id)
  
  drop = (id: string) => {
    const instance = this.storeInstances.get(id)
    instance?.destroy()
    this.storeInstances.delete(id)
    this.storePromises.delete(id)
    this.owners.delete(id)
  }
  
  clear = () => {
    for (const instance of this.storeInstances.values()) {
      instance.destroy()
    }

    this.storeInstances.clear()
    this.storePromises.clear()
    this.owners.clear()
  }
}


// --- Top-level provider giving access to the registry ---
const StoreRegistryContext = createContext<StoreRegistry | null>(null)
const defaultRegistry = new StoreRegistry()

type StoreRegistryProviderProps = {
  children: React.ReactNode
  registry?: StoreRegistry
}

export function StoreRegistryProvider({ children, registry }: StoreRegistryProviderProps) {
  const value = React.useMemo(() => registry ?? defaultRegistry, [registry])
  return <StoreRegistryContext value={value}>{children}</StoreRegistryContext>
}

function useStoreRegistry() {
  const registry = React.use(StoreRegistryContext)
  if (!registry) {
    throw new Error('useStoreRegistry must be used within a <StoreRegistryProvider>')
  }
  return registry
}


// --- Universal hook + preload helpers ---
export function useStore<TSchema extends LiveStoreSchema>(
  def: StoreDefinition<TSchema>,
  params?: CreateStoreParams
): Store<TSchema> {
  const storeRegistry = useStoreRegistry()

  const promise = storeRegistry.get(def, params)

  return React.use(promise) // Suspends the caller until the store is ready
}

export async function preloadStore<TSchema extends LiveStoreSchema>(
  def: StoreDefinition<TSchema>,
  params?: CreateStoreParams,
  registryOverride?: StoreRegistry
): Promise<Store<TSchema>> {
  const registry = registryOverride ?? defaultRegistry
  return registry.get(def, params)
}
```
