# Multi-Store Design Proposal (Global Registry)

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
type DefineStoreOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Unique name for the store type (e.g., "workspace", "issue").
   * This is used in telemetry and devtools.
   */
  name: string
  schema: TSchema
  adapter: Adapter
  batchUpdates?: (callback: () => void) => void
  /**
   * Whether to disable LiveStore Devtools.
   *
   * @default 'auto'
   */
  disableDevtools?: boolean | 'auto'
  /**
   * Payload that will be passed to the sync backend when connecting
   *
   * @default undefined
   */
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
}

type CreateStoreOptions<TSchema extends LiveStoreSchema, TContext = {}> = {
  storeId?: string
  /**
   * Payload that will be passed to the sync backend when connecting
   *
   * @default undefined
   */
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
}

type StoreDefinition<TSchema extends LiveStoreSchema> = {
  name: string
  schema: TSchema
  create(options: CreateStoreOptions): Promise<Store<TSchema>>
}
```



### Store Registry

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
### Using Stores

#### Hooks

- `useStore()` gets the store instance from the registry for the given store definition and storeId. If the store instance is not yet loaded, it will be created and loaded automatically. The hook will suspend the component until the store is ready.

- `useStoreRegistry()` returns the current store registry instance from context. It's useful for advanced use cases where you need direct access to the registry.

```tsx
function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore({
    storeDef: issueStoreDef,
    storeId: issueId
  })
  const issue = issueStore.useQuery(issueQuery(issueId))
  
  function handleUpdateTitle(newTitle: string) {
    issueStore.commit(issueEvents.issueTitleUpdated({ issueId, newTitle }))
  }
  
  return (
    <div>
      <h2>Issue: {issue.title}</h2>
      <button onClick={() => handleUpdateTitle('New Title')}>Update Title</button>
    </div>
  )
}
```

##### Types

```ts
type UseStoreOptions<TSchema extends LiveStoreSchema> = {
  storeDef: StoreDefinition<TSchema>
  storeId?: string
}

type UseStoreHook = <TSchema extends LiveStoreSchema>(
  options: UseStoreOptions<TSchema>
) => Store<TSchema>

type UseStoreRegistryHook = (
  /** Use this to use a custom StoreRegistry. Otherwise, the one from the nearest context will be used. */
  storeRegistry?: StoreRegistry
) => StoreRegistry
```

#### Preloading

`registry.preloadStore()` preloads the store instance for the given store definition and storeId. This is useful for preloading stores in route loaders or in event handlers. It does not suspend the component, but ensures the store is loaded and cached in the registry. It returns a promise that will either immediately resolve if the store is already loaded, or resolve once the store it is.

```tsx
function ShowIssueDetailsButton({ issueId }: { issueId: string }) {
  const registry = useStoreRegistry()

  const prefetch = () => {
    registry.preloadStore({
      storeDef: issueStoreDef,
      storeId: issueId,
    })
  }

  return (
    <button onMouseEnter={prefetch} onFocus={prefetch} onClick={...}>
      Show Details
    </button>
  )
}
```

##### Types

```ts
type PreloadStoreOptions<TSchema extends LiveStoreSchema> = {
  storeDef: StoreDefinition<TSchema>
  storeId?: string
}

type PreloadStore = <TSchema extends LiveStoreSchema>(
  options: PreloadStoreOptions<TSchema>,
) => Promise<void>
```

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
  const appStore = useAppStore() // Suspends the component until the store is ready
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
  const workspaceStore = useStore({ storeDef: workspaceStoreDef }) // No storeId provided, uses store definition name as default
  const workspace = workspaceStore.useQuery(workspaceQuery)
  return <div>Workspace: {workspace.name}</div>
}

function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore({ storeDef: issueStoreDef, storeId: issueId })
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
  const workspaceStore = useStore({ storeDef: workspaceStoreDef })
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
  const issueStore = useStore({ storeDef: issueStoreDef, storeId: issueId })
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

### User-Land Helpers

```ts
// src/stores/workspace/index.ts
import { useStore } from '@livestore/react'
import { useAuth, getAuth } from '../../auth.ts'

// Store definition as before...

// Our app by design has a single workspace per auth session
export function useCurrentWorkspaceStore() {
  const { orgId } = useAuth() // This can come from an auth context
  
  // We have a single workspace per org, so we can use the orgId as part of the storeId
  const storeId = `workspace-org_${orgId}`
  
  return useStore({ storeDef: workspaceStoreDef, storeId: storeId })
}

// We can also create a custom preload function
export async function preloadCurrentWorkspaceStore() {
  const { orgId } = await getAuth()
  const storeId = `workspace-org_${orgId}`
  await registry.preloadStore({ storeDef: workspaceStoreDef, storeId })
}
```

```tsx
// src/stores/issue/index.ts
import { createContext, use } from 'react'
import { useStore } from '@livestore/react'
import { useRouteParams } from 'my-router'


// Store definition as before...


// Having to pass an issueId prop through multiple layers.
// We can have a context to avoid that.
const IssueStoreContext = createContext<Store | null>(null)

// This component will suspend while the store is being created
export function IssueStoreProvider({ issueId, children }: { issueId: string, children: React.ReactNode }) {
  const store = useStore({ storeDef: issueStoreDef, storeId: issueId })
  return <IssueStoreContext.Provider value={store}>{children}</IssueStoreContext.Provider>
}

export function useIssueStore() {
  const store = React.use(IssueStoreContext)
  if (!store) throw new Error('useIssueStore must be used within an <IssueStoreProvider>')
  return store
}

// Or even better, if we're able to get the issueId from the route params
export function useIssueStoreFromRoute() {
  const { issueId } = useRouteParams()
  if (!issueId) throw new Error('useIssueStoreFromParams must be used within a route with an :issueId param')
  return useStore({ storeDef: issueStoreDef, storeId: issueId })
}
```

## Implementation


```tsx
import * as React from 'react'

// --- Registry caches create() results as Thenables (suspense-friendly) ---
export class StoreRegistry {
  private storePromises = new Map<string, Promise<Store<any>>>()
  private storeInstances = new Map<string, Store<any>>()
  private owners = new Map<string, StoreDefinition<any>>()

  async get<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    options: CreateStoreOptions<TSchema> = {},
  ): Promise<Store<TSchema>> {
    const storeId = options.storeId ?? def.name
    // Defaulting to the definition name keeps single-instance cases ergonomic.

    const owner = this.owners.get(storeId)
    if (owner && owner !== def) {
      throw new Error(
        `storeId "${storeId}" already belongs to "${owner.name}", not "${def.name}".`,
      )
    }
    // At this point the storeId is either unused or already registered to the same definition.

    let storePromise = this.storePromises.get(storeId)
    if (!storePromise) {
      // Lazily create the store the first time it is requested.
      storePromise = def.create({ ...options, storeId }).then((store) => {
        // Cache the resolved instance to enable imperative access (e.g. destroy calls).
        this.storeInstances.set(storeId, store)
        return store
      })

      this.storePromises.set(storeId, storePromise)
      this.owners.set(storeId, def)
    }

    return storePromise
  }

  async preloadStore<TSchema extends LiveStoreSchema>(
    options: PreloadStoreOptions<TSchema>,
  ): Promise<void> {
    const { storeDef, ...createOptions } = options
    // Reuse the main get() path so preload has identical caching semantics.
    await this.get(storeDef, createOptions)
  }

  has = (storeId: string) => this.storePromises.has(storeId)

  drop = (storeId: string) => {
    // Destroying the cached instance also evicts associated promises and ownership metadata.
    this.storeInstances.get(storeId)?.destroy()
    this.storeInstances.delete(storeId)
    this.storePromises.delete(storeId)
    this.owners.delete(storeId)
  }

  clear = () => {
    for (const store of this.storeInstances.values()) {
      // Ensure stores perform their own cleanup before we forget them.
      store.destroy()
    }

    this.storeInstances.clear()
    this.storePromises.clear()
    this.owners.clear()
  }
}

// --- Top-level provider giving access to the registry ---
const StoreRegistryContext = React.createContext<StoreRegistry | null>(null)
const defaultRegistry = new StoreRegistry()

type StoreRegistryProviderProps = {
  children: React.ReactNode
  registry?: StoreRegistry
}

export function StoreRegistryProvider({ children, registry }: StoreRegistryProviderProps) {
  // Allow callers to supply a scoped registry while falling back to the shared singleton.
  const value = React.useMemo(() => registry ?? defaultRegistry, [registry])
  return <StoreRegistryContext value={value}>{children}</StoreRegistryContext>
}

export function useStoreRegistry(override?: StoreRegistry): StoreRegistry {
  // Let advanced users inject a registry without having to remount providers.
  if (override) return override

  const registry = React.use(StoreRegistryContext)
  if (!registry) {
    throw new Error('useStoreRegistry must be used within a <StoreRegistryProvider>')
  }

  return registry
}

type UseStoreOptions<TSchema extends LiveStoreSchema> = CreateStoreOptions<TSchema> & {
  storeDef: StoreDefinition<TSchema>
}

export function useStore<TSchema extends LiveStoreSchema>(
  options: UseStoreOptions<TSchema>,
): Store<TSchema> {
  const { storeDef, ...createOptions } = options
  const registry = useStoreRegistry()
  // Suspense integration: React.use awaits the promise returned by the registry.
  const storePromise = registry.get(storeDef, createOptions)

  return React.use(storePromise)
}
```
