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

A store definition can then be used to create multiple store instances, each identified by a unique `storeId`. Callers must provide a `storeId` whenever they create or access a store instance, and it must be globally unique to avoid collisions with other store instances.

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
   * Overrides the registry-level gcTime for stores created from this definition.
   */
  gcTime?: number
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
  /**
   * Globally unique identifier for this particular store instance.
   */
  storeId: string
  /**
   * Per-call override for the inactivity timeout (milliseconds).
   */
  gcTime?: number
  /**
   * Optional signal allowing adapters to cancel long-running setup if the store is dropped before
   * creation finishes.
   */
  signal?: AbortSignal
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
  gcTime?: number
  create(options: CreateStoreOptions): Promise<Store<TSchema>>
}

// Unless overridden on the provider or per-call, gcTime defaults to 60 seconds in the browser
// and Infinity during SSR to avoid tearing down stores while generating HTML.
```



### Store Registry

One registry for the entire app to manage all store instances of any type.

- Instances stay alive while they have at least one observer (e.g. via `useStore`).
- When the observer count drops to zero, a garbage-collection timer starts. After `gcTime`
  milliseconds (defaults to 60s in the browser, infinity on the server) the registry destroys the
  instance unless a new observer arrives. Passing `gcTime: Infinity` disables the timer.
- Store definitions and providers can override the inactivity timeout so teams can tune memory
  pressure per store type.
- During SSR we always create a fresh `StoreRegistry`, mirroring how TanStack Query isolates caches
  per request. On the client a shared singleton keeps the registry stable unless you supply your
  own instance.
- If multiple observers provide different `gcTime` overrides, the registry keeps the longest
  duration active so late subscribers can opt in to longer retention without being pruned by
  shorter-lived peers.

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
type UseStoreOptions<TSchema extends LiveStoreSchema> = CreateStoreOptions<TSchema> & {
  storeDef: StoreDefinition<TSchema>
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

`registry.preloadStore()` preloads the store instance for the given store definition and storeId. This is useful for preloading stores in route loaders or in event handlers. It does not suspend the component, but ensures the store is loaded and cached in the registry. It returns a promise that will either immediately resolve if the store is already loaded, or resolve once the store is. If no component mounts a `useStore()` observer after preloading, the instance will still be evicted once it sits idle for `gcTime` milliseconds (default 60 seconds in the browser).

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
type PreloadStoreOptions<TSchema extends LiveStoreSchema> = CreateStoreOptions<TSchema> & {
  storeDef: StoreDefinition<TSchema>
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
  const workspaceStore = useStore({ storeDef: workspaceStoreDef, storeId: 'workspace-root' })
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
  const workspaceStore = useStore({ storeDef: workspaceStoreDef, storeId: 'workspace-root' })
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

### User-Space Helpers

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

// --- Registry caches create() results and retires inactive stores after gcTime ---
const DEFAULT_GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

type StoreRegistryOptions = {
  gcTime?: number
}

type StoreEntry = {
  promise: Promise<Store<any>>
  instance?: Store<any>
  observers: number
  gcTimer?: ReturnType<typeof setTimeout>
  gcTime: number
  baseGcTime: number
  observerGcTimes: Map<number, number>
  storeDef: StoreDefinition<any>
  abortController: AbortController | null
}

export class StoreRegistry {
  private readonly options: StoreRegistryOptions
  private readonly entries = new Map<string, StoreEntry>()

  constructor(options: StoreRegistryOptions = {}) {
    this.options = options
  }

  private resolveGcTime<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    override?: number,
  ): number {
    if (override === Infinity) return Infinity
    if (typeof override === 'number') return override
    if (def.gcTime === Infinity) return Infinity
    if (typeof def.gcTime === 'number') return def.gcTime
    if (this.options.gcTime === Infinity) return Infinity
    if (typeof this.options.gcTime === 'number') return this.options.gcTime
    return DEFAULT_GC_TIME
  }

  private scheduleDrop(storeId: string, delay: number) {
    return setTimeout(() => {
      const latest = this.entries.get(storeId)
      if (!latest || latest.observers > 0) return
      this.drop(storeId)
    }, delay)
  }

  private updateEntryGcTime(entry: StoreEntry) {
    let max = entry.baseGcTime
    for (const gc of entry.observerGcTimes.keys()) {
      if (gc === Infinity) {
        max = Infinity
        break
      }
      if (gc > max) max = gc
    }
    entry.gcTime = max
  }

  async get<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    options: CreateStoreOptions<TSchema>,
  ): Promise<Store<TSchema>> {
    const { storeId, gcTime: gcOverride, signal, ...rest } = options
    const owner = this.entries.get(storeId)?.storeDef
    if (owner && owner !== def) {
      throw new Error(
        `storeId "${storeId}" already belongs to "${owner.name}", not "${def.name}".`,
      )
    }

    let entry = this.entries.get(storeId)

    if (entry?.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = undefined
    }

    if (!entry) {
      const computedGcTime = this.resolveGcTime(def, gcOverride)
      const abortController = typeof AbortController === 'undefined' ? null : new AbortController()
      const controllerSignal = signal ?? abortController?.signal

      const entryPlaceholder: StoreEntry = {
        promise: Promise.resolve(),
        instance: undefined,
        observers: 0,
        gcTimer: undefined,
        gcTime: computedGcTime,
        baseGcTime: computedGcTime,
        observerGcTimes: new Map(),
        storeDef: def,
        abortController,
      }

      const promise = Promise.resolve()
        .then(() => def.create({ storeId, gcTime: computedGcTime, signal: controllerSignal, ...rest }))
        .then((store) => {
          const current = this.entries.get(storeId)
          if (!current || current !== entryPlaceholder) {
            try {
              store.destroy?.()
            } catch {
              // Ignore destroy failures when the entry was already removed.
            }
            return store
          }

          entryPlaceholder.instance = store

          if (entryPlaceholder.observers === 0 && entryPlaceholder.gcTime !== Infinity && !entryPlaceholder.gcTimer) {
            entryPlaceholder.gcTimer = this.scheduleDrop(storeId, entryPlaceholder.gcTime)
          }

          return store
        })
        .catch((error) => {
          if (this.entries.get(storeId) === entryPlaceholder) {
            this.entries.delete(storeId)
          }
          throw error
        })
        .finally(() => {
          entryPlaceholder.abortController = null
        })

      entryPlaceholder.promise = promise
      entry = entryPlaceholder

      this.entries.set(storeId, entry)
    } else if (gcOverride !== undefined) {
      const newBase = this.resolveGcTime(def, gcOverride)
      if (entry.baseGcTime !== newBase) {
        entry.baseGcTime = newBase
        this.updateEntryGcTime(entry)
      }
    }

    if (entry.instance && entry.observers === 0 && entry.gcTime !== Infinity) {
      entry.gcTimer = this.scheduleDrop(storeId, entry.gcTime)
    }

    return entry.promise
  }

  retain<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    gcOverride?: number,
  ) {
    const entry = this.entries.get(storeId)
    if (!entry) {
      throw new Error(`StoreRegistry.retain called before store "${storeId}" was created.`)
    }

    if (entry.storeDef !== def) {
      throw new Error(
        `storeId "${storeId}" already belongs to "${entry.storeDef.name}", not "${def.name}".`,
      )
    }

    entry.observers += 1
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = undefined
    }

    let observerGc: number | undefined
    if (gcOverride !== undefined) {
      observerGc = this.resolveGcTime(def, gcOverride)
      const count = entry.observerGcTimes.get(observerGc) ?? 0
      entry.observerGcTimes.set(observerGc, count + 1)
    }

    this.updateEntryGcTime(entry)

    // Return a disposer so callers can release automatically via useEffect cleanup.
    return () => this.release(def, storeId, observerGc)
  }

  release<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    observerGc?: number,
  ) {
    const entry = this.entries.get(storeId)
    if (!entry || entry.storeDef !== def) return

    entry.observers = Math.max(0, entry.observers - 1)

    if (observerGc !== undefined) {
      const count = entry.observerGcTimes.get(observerGc)
      if (count !== undefined) {
        if (count <= 1) {
          entry.observerGcTimes.delete(observerGc)
        } else {
          entry.observerGcTimes.set(observerGc, count - 1)
        }
      }
    }

    this.updateEntryGcTime(entry)

    if (entry.observers === 0 && entry.gcTime !== Infinity && !entry.gcTimer) {
      entry.gcTimer = this.scheduleDrop(storeId, entry.gcTime)
    }
  }

  async preloadStore<TSchema extends LiveStoreSchema>(
    options: PreloadStoreOptions<TSchema>,
  ): Promise<void> {
    const { storeDef, ...createOptions } = options
    // Reuse the main get() path so preloads share caching and GC rules with suspense callers.
    await this.get(storeDef, createOptions)
  }

  has = (storeId: string) => this.entries.has(storeId)

  drop = (storeId: string) => {
    const entry = this.entries.get(storeId)
    if (!entry) return

    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer)
    }

    if (entry.abortController) {
      entry.abortController.abort()
      entry.abortController = null
    }
    try {
      entry.instance?.destroy()
    } catch {
      // Ignore destroy failures; the registry cleanup should still proceed.
    } finally {
      this.entries.delete(storeId)
    }
  }

  clear = () => {
    for (const entry of this.entries.values()) {
      if (entry.gcTimer) clearTimeout(entry.gcTimer)
      if (entry.abortController) {
        entry.abortController.abort()
        entry.abortController = null
      }
      try {
        entry.instance?.destroy()
      } catch {
        // Ignore destroy failures during bulk cleanup.
      }
    }

    this.entries.clear()
  }
}

// --- Top-level provider giving access to (and configuring) the registry ---
const StoreRegistryContext = React.createContext<StoreRegistry | null>(null)
const defaultBrowserRegistry = typeof window !== 'undefined' ? new StoreRegistry() : null

type StoreRegistryProviderProps = {
  children: React.ReactNode
  registry?: StoreRegistry
  gcTime?: number
}

export function StoreRegistryProvider({ children, registry, gcTime }: StoreRegistryProviderProps) {
  // Allow callers to supply a scoped registry while falling back to a shared singleton.
  const value = React.useMemo(() => {
    if (registry) return registry
    if (typeof window === 'undefined') {
      return new StoreRegistry({ gcTime })
    }
    if (gcTime !== undefined) {
      return new StoreRegistry({ gcTime })
    }
    return defaultBrowserRegistry ?? new StoreRegistry()
  }, [registry, gcTime])

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
  const { storeDef, storeId, gcTime, ...createOptions } = options
  const registry = useStoreRegistry()
  // Suspense integration: React.use awaits the promise returned by the registry.
  const storePromise = registry.get(storeDef, { storeId, gcTime, ...createOptions })
  const store = React.use(storePromise)

  // Track observer count so the registry can evict inactive stores after gcTime.
  React.useEffect(() => {
    const dispose = registry.retain(storeDef, storeId, gcTime)
    return () => dispose()
  }, [registry, storeDef, storeId, gcTime])

  return store
}
```
