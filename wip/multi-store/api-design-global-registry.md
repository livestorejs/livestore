# Multi-Store API Design Proposal

This document proposes the API design for supporting multiple LiveStore instances in React applications. The design prioritizes simplicity, type safety, and React best practices while enabling both simple and complex use cases.

## API Overview

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
/** Static configuration when defining a store type. */
type DefineStoreOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Unique name for the store type (e.g., "workspace", "issue").
   * This is used in telemetry and devtools.
   */
  name: string
  schema: TSchema
  adapter: Adapter
  /**
   * Overrides the global-level gcTime for stores created from this definition.
   * 
   * @defaultValue 60 seconds in the browser, Infinity during SSR (to prevent stores getting disposed before HTML generation completes)
   */
  gcTime?: number
  boot?: (
    store: Store<TSchema>,
    ctx: { migrationsReport: MigrationsReport; parentSpan: otel.Span },
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}
```

### MultiStoreProvider

`<MultiStoreProvider>` internally provides a registry (`StoreRegistry`) and accepts default options (`defaultStoreOptions`) that apply to all stores created within its context.

`StoreRegistry` is an internal class that manages store instance caching, ref-counting, and garbage collection. It is framework-agnostic and can be used outside of React if needed. Its garbage collection strategy is as follows:

- Instances stay alive while they have at least one observer (e.g. via `useStore`).
- When the observer count drops to zero, a garbage-collection timer starts. After `gcTime`
  milliseconds (defaults to 60s in the browser, infinity on the server) the registry destroys the
  instance unless a new observer arrives. Passing `gcTime: Infinity` disables the timer.
- If multiple observers (`useStore()` calls) provide different `gcTime` overrides, the registry keeps the longest
  duration active so late subscribers can opt in to longer retention without being pruned by
  shorter-lived peers.

```tsx
// src/App.tsx
import { Suspense, useState } from 'react'
import { MultiStoreProvider } from '@livestore/react'
import MainContent from './MainContent.tsx'

export default function App() {
  return (
    <MultiStoreProvider
      defaultStoreOptions={{
        batchUpdates,
        syncPayload: {authToken: '***'},
        otelOptions: { serviceName: 'my-app' },
        gcTime: 2 * 60_000,
      }}
    >
      <Suspense fallback={<div>Loading...</div>}>
        <MainContent />
      </Suspense>
    </MultiStoreProvider>
  )
}
```

#### Types

```ts
/** Default options that apply to all stores created when using MultiStoreProvider */
type StoreDefaultOptions = {
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
  /**
   * Overrides the global-level gcTime for all stores created within this provider.
   *
   * @defaultValue 60 seconds in the browser, Infinity during SSR (to prevent stores getting disposed before HTML generation completes)
   */
  gcTime?: number
}
```

### Using Stores

#### Hooks

- `useStore()` gets the store instance from the registry for the given store definition and storeId. If the store instance is not yet loaded, it will be created and loaded automatically. The hook will suspend the component until the store is ready.

- `useStoreRegistry()` returns the current store registry instance from context. It's useful for advanced use cases where you need direct access to the registry (e.g. for preloading stores).

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
  /** Globally unique identifier for this particular store instance. */
  storeId: string
  /** Per-call override for the inactivity timeout (milliseconds). */
  gcTime?: number
}

declare function useStore<TSchema extends LiveStoreSchema>(): Store<TSchema> // Single-store usage
declare function useStore<TSchema extends LiveStoreSchema>(options: UseStoreOptions<TSchema>): Store<TSchema> // Multi-store usage
declare function useStore<TSchema extends LiveStoreSchema>(options?: UseStoreOptions<TSchema>): Store<TSchema> // Implementation

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
type PreloadStoreOptions<TSchema extends LiveStoreSchema> = {
  /** Store definition created via `defineStore()`. */
  storeDef: StoreDefinition<TSchema>
  /** Globally unique identifier for this particular store instance. */
  storeId: string
  /** Per-call override for the inactivity timeout (milliseconds). */
  gcTime?: number
  /** Allows aborting the store creation if it takes too long or the user navigates away. */ 
  signal?: AbortSignal
}

type PreloadStore = <TSchema extends LiveStoreSchema>(
  options: PreloadStoreOptions<TSchema>,
) => Promise<void>
```

## Usage Examples

### Single Store Instance (Common Case)

Same as before, but now uses Suspense and Error Boundaries instead of `renderLoading` and `renderError` props.

```tsx
function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load app</div>}>
      <LiveStoreProvider
        schema={schema}
        adapter={adapter}
        batchUpdates={batchUpdates}
        syncPayload={{ authToken: '***' }}
      >
        <Suspense fallback={<div>Loading app...</div>}>
          <MainContent />
        </Suspense>
      </LiveStoreProvider>
    </ErrorBoundary>
  )
}

function MainContent() {
  const appStore = useStore() // Suspends the component until the store is ready
  const issues = appStore.useQuery(issuesQuery)
  return <IssueList issues={issues} />
}
```

### Independent Store Instances

```tsx
function App() {
  return (
    <MultiStoreProvider
      defaultStoreOptions={{
        batchUpdates,
        syncPayload: {authToken: '***'},
        otelOptions: { serviceName: 'my-app' },
        gcTime: 2 * 60_000,
      }}
    >
      <MainContent />
    </MultiStoreProvider>
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
  const workspaceStore = useStore({
    storeDef: workspaceStoreDef,
    storeId: 'workspace-root',
    gcTime: 2 * 60_000 // Can optionally override gcTime for a particular store instance
  })
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
    <MultiStoreProvider
      defaultStoreOptions={{
        batchUpdates,
        syncPayload: {authToken: '***'},
        otelOptions: { serviceName: 'my-app' },
        gcTime: 2 * 60_000,
      }}
    >
      <MainContent />
    </MultiStoreProvider>
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

// It can be tedious to always pass issueId/storeId around, so we can create a context provider
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
import { StoreOptions } from "./store-types";

// --- Single Store ---

const DefaultStoreContext = React.createContext<Promise<Store> | null>(null);

type StoreOptions = {
  schema: TSchema
  adapter: Adapter
  storeId?: string // defaults to "default"
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  abortSignal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
  boot?: (
    store: Store<TSchema>,
    ctx: { migrationsReport: MigrationsReport; parentSpan: otel.Span },
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}

/** Single-store provider: no store registry; provides a single default store */
export function LiveStoreProvider<Store>({
  schema,
  adapter,
  storeId = 'default',
  batchUpdates,
  syncPayload,
  abortSignal,
  otelOptions,
  boot,
}: PropsWithChildren<StoreOptions>) {
  const storePromise = useMemo(() => createStorePromise(storeOptions), [props.storeOptions]);
  return (
    <DefaultStoreContext.Provider value={storePromise}>
      {props.children}
    </DefaultStoreContext.Provider>
  );
}

// --- Multi Store ---

/**
 * The default time in milliseconds that inactive store instances remains in memory.
 * When a store instance becomes inactive, that store instance will be garbage collected after this duration.
 * Store instances transition to the inactive state as soon as there are no observers registered, so when all components
 * which use that query have unmounted.
 */
const DEFAULT_GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

/** Default options that apply to all stores created when using MultiStoreProvider */
type StoreDefaultOptions = {
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
  /**
   * Overrides the global-level gcTime for all stores created within this provider.
   *
   * @defaultValue 60 seconds in the browser, Infinity during SSR (to prevent stores getting disposed before HTML generation completes)
   */
  gcTime?: number
}

type StoreEntry = {
  promise: Promise<Store>
  instance?: Store
  observers: number
  gcTimer?: ReturnType<typeof setTimeout>
  gcTime: number
  baseGcTime: number
  observerGcTimes: Map<number, number>
  storeDef: StoreDefinition
  abortController: AbortController | null
}

export class StoreRegistry {
  private readonly defaultStoreOptions: StoreDefaultOptions
  private readonly entries = new Map<string, StoreEntry>()

  constructor(defaultStoreOptions: StoreDefaultOptions = {}) {
    this.defaultStoreOptions = defaultStoreOptions
  }

  private resolveGcTime<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    override?: number,
  ): number {
    if (typeof override === 'number') return override
    if (typeof def.gcTime === 'number') return def.gcTime
    if (typeof this.defaultStoreOptions.gcTime === 'number') return this.defaultStoreOptions.gcTime
    return DEFAULT_GC_TIME
  }

  private scheduleDrop(storeId: string, delay: number) {
    // GC timers are intentionally lazy; we always re-check observer counts to avoid destroying a
    // store that was revived while the timer was pending.
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
    const {storeId, gcTime: gcOverride, signal, ...rest} = options
    const owner = this.entries.get(storeId)?.storeDef
    if (owner && owner !== def) {
      throw new Error(
        `storeId "${storeId}" already belongs to "${owner.name}", not "${def.name}".`,
      )
    }

    let entry = this.entries.get(storeId)

    if (entry?.gcTimer) {
      // Any new interest resets the pending GC timer. If no observer re-attaches we’ll reschedule
      // below using the latest TTL.
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
      .then(() => def.create({storeId, gcTime: computedGcTime, signal: controllerSignal, ...rest}))
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
    const {storeDef, ...createOptions} = options
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
      // Manual drops are “force evict” operations—callers should ensure they are not holding onto
      // the store elsewhere. We still delete the table entry to avoid dangling references.
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

const StoreRegistryContext = React.createContext<StoreRegistry | null>(null)

/** Multi-store provider: exposes the registry for parametric useStore */
export function MultiStoreProvider(props: {
  defaultStoreOptions: StoreDefaultOptions;
  children: React.ReactNode;
}) {
  const registry = React.useMemo(
    () => new StoreRegistry(props.defaultStoreOptions),
    [props.defaultStoreOptions],
  )

  React.useEffect(() => {
    return () => {
      registry.clear()
    }
  }, [registry])

  return <StoreRegistryContext.Provider value={registry}>{props.children}</StoreRegistryContext.Provider>;
}


export function useStoreRegistry(override?: StoreRegistry): StoreRegistry {
  if (override) return override

  const registry = useContext(StoreRegistryContext)
  if (!registry) {
    throw new Error('useStoreRegistry() must be used within <MultiStoreProvider>')
  }

  return registry
}

// --- useStore() ---

type UseStoreOptions<TSchema extends LiveStoreSchema> = {
  /** Store definition created via `defineStore()`. */
  storeDef: StoreDefinition<TSchema>
  /** Globally unique identifier for this particular store instance. */
  storeId: string
  /** Per-call override for the inactivity timeout (milliseconds). */
  gcTime?: number
}

export function useStore<TSchema extends LiveStoreSchema>(): Store<TSchema> // Single-store usage
export function useStore<TSchema extends LiveStoreSchema>(options: UseStoreOptions<TSchema>): Store<TSchema> // Multi-store usage
export function useStore<TSchema extends LiveStoreSchema>(options?: UseStoreOptions<TSchema>): Store<TSchema> {
  // Single-store usage
  if (!options) {
    const defaultStorePromise = useContext(DefaultStoreContext);
    if (!defaultStorePromise) {
      throw new Error(
        'useStore() without params must be used within <LiveStoreProvider>. For multi-store usage, use useStore({ storeDef, storeId }) within <LiveStoreRegistryProvider>.'
      );
    }
    return use(defaultStorePromise); // Suspends the calling component until the promise resolves.
  }

  // Multi-store usage
  const registry = useContext(StoreRegistryContext);
  if (!registry) {
    throw new Error(
      'useStore({ storeDef, storeId }) must be used within <LiveStoreRegistryProvider>. For single-store usage, use useStore() without params within <LiveStoreProvider>.',
    );
  }

  const storePromise = registry.get(storeDef, {storeId, gcTime, ...createOptions})
  const store = use(storePromise) // Suspends the calling component until the promise resolves.

  // Track observer count so the registry can evict inactive stores after gcTime.
  React.useEffect(() => {
    // retain() hands back a disposer so we always release—even through Strict Mode double-mounts.
    const dispose = registry.retain(storeDef, storeId, gcTime)
    return () => dispose()
  }, [registry, storeDef, storeId, gcTime])

  return store
}
```
