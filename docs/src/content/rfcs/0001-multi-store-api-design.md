# Multi-Store API Design

## Context

### Current LiveStore Architecture

LiveStore currently supports a **single store instance per application**. Applications instantiate one store with a specific schema and adapter, then provide it to the React tree via `<LiveStoreProvider>`. All components access this shared store instance using `useStore()`.

**Current pattern:**

```tsx
function App() {
  return (
    <LiveStoreProvider
      schema={appSchema}
      adapter={adapter}
      renderLoading={() => <div>Loading...</div>}
      renderError={(error) => <div>Error: {error.message}</div>}
    >
      <MainContent />
    </LiveStoreProvider>
  )
}

function MainContent() {
  const store = useStore() // Always returns the same global store
  const data = store.useQuery(myQuery)
  return <div>{data}</div>
}
```

This model works well for applications with a single, unified data domain.

### Use Cases Driving Multi-Store Support

Several product scenarios require **multiple independent store instances**:

#### 1. Multi-Tenant/Workspace/Organization Applications

Many apps allow users to belong to multiple isolated workspaces, organizations, or tenants. Each workspace represents a completely independent data domain. For example:
- Slack: Each workspace has independent data that shouldn't be mixed
- Notion: Each workspace has different pages, databases, and permissions
- Linear: Each organization has separate projects and issues

#### 2. Partial Data Synchronization

Many applications need to selectively synchronize subsets of data rather than syncing an entire monolithic dataset. This is critical for:
- Storage Limits: Browsers have [limited storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- Memory Limits: A browser tab can only hold so much data in memory
- Bandwidth Optimization: Don't sync data the user isn't viewing
- Performance: Faster initial load by deferring non-critical data
- Privacy: Only sync data the user has permission to access

## Problem

### Problem Statement

**LiveStore currently lacks a first-class API for managing multiple independent store instances within a single application.**

### Current Workarounds

#### Workaround 1: Multiple Provider Trees

```tsx
// ❌ Problematic: Nested providers
function App() {
  return (
    <LiveStoreProvider schema={workspaceSchema} adapter={workspaceAdapter}>
      <LiveStoreProvider schema={issueSchema} adapter={issueAdapter}>
        {/* Can only access one store at a time */}
      </LiveStoreProvider>
    </LiveStoreProvider>
  )
}
```

**Issues:**
- Can't control which provider's store `useStore()` returns
- Provider nesting becomes deeply nested and unmanageable
- No centralized lifecycle management

#### Workaround 2: Manual Store Management

```tsx
// ❌ Problematic: Manual instance management
const issueStore1 = await createStorePromise({ ... })
const issueStore2 = await createStorePromise({ ... })

// Pass via props (verbose) or module state (memory leaks)
```

**Issues:**
- No automatic cleanup (memory leaks)
- Loses React integration (Suspense, Error Boundaries)
- Manual ref-counting and disposal logic
- Difficult to coordinate loading states

### Requirements

A multi-store solution must:

1. **✅ Support Multiple Store Types/Definitions**: Different schemas, adapters, configurations
2. **✅ Support Multiple Instances**: Same definition, different data (e.g., issue-1, issue-2)
3. **✅ Dynamic Store IDs**: Store IDs determined at runtime (e.g., from route params)
4. **✅ Common Case Optimization**: Multi-store support shouldn't complicate single-store usage
5. **✅ Automatic Lifecycle Management**: Creation, caching, garbage collection
6. **✅ Type Safety**: Full TypeScript inference from schema to usage
7. **✅ React Integration**: Natural use of Suspense, Error Boundaries, hooks
8. **✅ Framework Agnostic Core**: Core logic reusable outside React (Node.js, CLI, etc.)
9. **✅ Testability**: Easy to create isolated store instances for tests

## Proposed Solution

### Architecture Overview

The multi-store architecture introduces three key concepts:

```
┌─────────────────────────────────────────────────────────────┐
│                     <MultiStoreProvider>                    │
│  • Provides StoreRegistry                                   │
│  • Passes default store options (gcTime, syncPayload, etc.) │
│  • Lives at application root                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ provides
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       StoreRegistry                         │
│  • Central registry for all store instances                 │
│  • Key: storeDefinition + storeId                           │
│  • Manages caching, ref-counting, garbage collection        │
│  • Framework-agnostic (reusable outside React)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ manages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Store Instances                           │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │ workspace:123 │  │ issue:456     │  │ issue:789     │    │
│  │ observers: 2  │  │ observers: 1  │  │ observers: 0  │    │
│  │ gcTimer: null │  │ gcTimer: null │  │ gcTimer: 60s  │    │
│  └───────────────┘  └───────────────┘  └───────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

#### Key Design Principles

1. **Store Definition vs Store Instance**
  - A **definition** is a blueprint (schema + adapter + config)
  - An **instance** is a loaded store with data (identified by storeId)
  - One definition → many instances

2. **Automatic Lifecycle Management**
  - Instances are created on first access
  - Cached for subsequent access
  - Ref-counted via observers (components using `useStore()`)
  - Auto-disposed after `gcTime` when observers drop to zero (see [Automatic Garbage Collection with gcTime](#automatic-garbage-collection-with-gctime))

3. **Configuration Cascade**
  - Provider defaults → Definition defaults → Call-site overrides
  - Later layers override earlier ones
  - Allows global policy with local control (see [Configuration Cascade](#configuration-cascade-provider--definition--call-site))

4. **Framework Agnostic Core**
  - `StoreRegistry` doesn't depend on React
  - React bindings are a thin wrapper (see [Generic useStore() Hook vs. Per-Definition Hooks](#generic-usestore-hook-vs-per-definition-hooks))

### API Surface Summary

#### Authoring

| API             | Purpose                               | Example                                           |
|:----------------|:--------------------------------------|:--------------------------------------------------|
| `defineStore()` | Create a store definition (blueprint) | `defineStore({ name: 'issue', schema, adapter })` |

#### Consumption

| API                       | Purpose                                     | Context Required       |
|:--------------------------|:--------------------------------------------|:-----------------------|
| `<LiveStoreProvider>`     | Single-store provider (backward compatible) | None                   |
| `<MultiStoreProvider>`    | Multi-store provider with registry          | None                   |
| `useStore()`              | Get store instance (suspends until ready)   | Either provider        |
| `useStoreRegistry()`      | Get registry for advanced operations        | `<MultiStoreProvider>` |
| `registry.preloadStore()` | Preload store without suspending            | `<MultiStoreProvider>` |
| `registry.drop()`         | Manually evict store instance               | `<MultiStoreProvider>` |
| `registry.clear()`        | Evict all store instances                   | `<MultiStoreProvider>` |

### Authoring API

The authoring API focuses on **defining store blueprints** that can be instantiated multiple times.

#### `defineStore()`

Creates a store definition—a reusable blueprint for loading store instances with a specific schema and adapter.

**Signature:**

```ts
function defineStore<TSchema extends LiveStoreSchema>(
  options: DefineStoreOptions<TSchema>
): StoreDefinition<TSchema>
```

**Parameters:**

```ts
type DefineStoreOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Unique name for this store type (e.g., "workspace", "issue").
   * Used in telemetry, devtools, and error messages.
   * 
   * Note: Multiple definitions can share the same name, but each
   * definition gets a unique internal ID to prevent collisions.
   */
  name: string

  /**
   * Schema describing the data structure.
   */
  schema: TSchema

  /**
   * Adapter for persistence and synchronization.
   */
  adapter: Adapter

  /**
   * Default garbage collection time (milliseconds) for instances of this definition.
   * When observer count drops to zero, instances remain cached for this
   * duration before being disposed.
   *
   * @defaultValue 60 seconds in browser, Infinity during SSR to avoid
   * disposing store instances before server render completes.
   */
  gcTime?: number

  /**
   * Bootstrap function called once per instance after loading completes.
   */
  onLoad?: (
    store: Store<TSchema>,
    ctx: {
      migrationsReport: MigrationsReport
      parentSpan: otel.Span
    }
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}
```

**Returns:**

```ts
type StoreDefinition<TSchema extends LiveStoreSchema> = {
  /**
   * Internal unique identifier for this definition.
   * Generated automatically to prevent collisions even if names are reused.
   */
  readonly definitionId: string

  /**
   * Human-readable name for this store type.
   */
  readonly name: string

  /**
   * Schema for type inference.
   */
  readonly schema: TSchema

  /**
   * Other configuration (not exposed directly).
   */
  // ... internal fields
}
```

**Example:**

```tsx
// src/stores/workspace/index.ts
import { defineStore } from '@livestore/livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { workspaceSchema } from './schema'
import worker from './worker?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const workspaceStoreDef = defineStore({
  name: 'workspace',
  schema: workspaceSchema,
  adapter,
  gcTime: Infinity, // Never evict the main workspace store
  onLoad: async (store, { migrationsReport, parentSpan }) => {
    // Initialize workspace-specific subscriptions
    console.log('Workspace store booted', { migrationsReport })
  },
})

// TypeScript infers the schema type from the definition
// workspaceStoreDef.schema is typed as typeof workspaceSchema
```

```tsx
// src/stores/issue/index.ts
import { defineStore } from '@livestore/livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { issueSchema } from './schema'
import worker from './worker?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
  gcTime: 2 * 60_000, // Evict inactive issues after 2 minutes
})

// Even if we create another definition with name: 'issue',
// issueStoreDef.definitionId will be unique
```

#### Store Definition Best Practices

**✅ DO:**
- Define store definitions at module level (they're singletons)
- Export definitions for reuse across components
- Use descriptive names that match your domain model
- Optionally, set appropriate `gcTime` based on data access patterns

**❌ DON'T:**
- Create definitions dynamically in components (causes re-renders)
- Include user-specific data in the definition (use `storeId` in `useStore()` instead)
- Set `gcTime: 0` (instances would be disposed immediately)

### Consumption API

The consumption API provides **React components and hooks** for accessing store instances.

#### `<MultiStoreProvider>`

Provides a `StoreRegistry` to the component tree and configures default options for all stores.

-  Rationale and separation from `<LiveStoreProvider>` (see [Different Provider for Multi-Store](#different-provider-for-multi-store-multistoreprovider))
-  Naming rationale (see [Name it MultiStoreProvider vs. Alternatives](#name-it-multistoreprovider-vs-alternatives))

**Props:**

```ts
type MultiStoreProviderProps = {
  /**
   * Default options that apply to all stores loaded within this provider.
   * Can be overridden by individual definitions or useStore() calls.
   */
  defaultStoreOptions?: StoreDefaultOptions

  children: React.ReactNode
}

type StoreDefaultOptions = {
  /**
   * Function to batch React state updates.
   * Typically React's unstable_batchedUpdates or similar.
   */
  batchUpdates?: (callback: () => void) => void

  /**
   * Payload sent to sync server for authentication, tenancy, etc.
   */
  syncPayload?: Schema.JsonValue

  /**
   * OpenTelemetry configuration for tracing and metrics.
   */
  otelOptions?: Partial<OtelOptions>

  /**
   * Default garbage collection time (milliseconds) for all stores.
   *
   * @defaultValue 60 seconds in browser, Infinity during SSR to avoid
   * disposing store instances before server render completes.
   */
  gcTime?: number
}
```

**Example:**

```tsx
// src/App.tsx
import { Suspense } from 'react'
import { MultiStoreProvider } from '@livestore/react'
import { unstable_batchedUpdates } from 'react-dom'
import { useAuth } from '../../auth'
import MainContent from './MainContent'

export default function App() {
  const { authToken } = useAuth()
  
  return (
    <MultiStoreProvider
      defaultStoreOptions={{
        batchUpdates: unstable_batchedUpdates,
        syncPayload: {
          authToken: authToken,
          apiVersion: 'v2',
        },
        otelOptions: {
          serviceName: 'my-app',
          endpoint: 'https://otel.example.com',
        },
        gcTime: 2 * 60_000, // 2 minutes default
      }}
    >
      <Suspense fallback={<div>Loading app...</div>}>
        <MainContent />
      </Suspense>
    </MultiStoreProvider>
  )
}
```

**Configuration Precedence:**

```
┌──────────────────────────────────────────────────────────┐
│  Call-site overrides (useStore({ gcTime: X }))           │  ← Highest
├──────────────────────────────────────────────────────────┤
│  Definition defaults (defineStore({ gcTime: X }))        │  ← Middle
├──────────────────────────────────────────────────────────┤
│  Provider defaults (defaultStoreOptions.gcTime)          │  ← Lowest
└──────────────────────────────────────────────────────────┘
```

Later layers replace earlier ones for scalar values (gcTime), but merge for objects (otelOptions, syncPayload). See [Configuration Cascade](#configuration-cascade-provider--definition--call-site).

#### `useStore()`

Hook to access a store instance. Suspends the component until the store is ready (see [Suspend on useStore Instead of Render Prop](#suspend-on-usestore-instead-of-render-prop)). It is a single generic hook (see [Generic `useStore()` Hook vs. Per-Definition Hooks](#generic-usestore-hook-vs-per-definition-hooks)).

**Signatures:**

```ts
// Single-store usage (backward compatible)
function useStore<TSchema extends LiveStoreSchema>(): Store<TSchema>

// Multi-store usage
function useStore<TSchema extends LiveStoreSchema>(
  options: UseStoreOptions<TSchema>
): Store<TSchema>
```

**Options:**

```ts
type UseStoreOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Store definition created via defineStore().
   */
  storeDef: StoreDefinition<TSchema>

  /**
   * Globally unique identifier for this store instance.
   * 
   * Requirements:
   * - Must be stable across renders for the same logical entity
   * - Must be globally unique (no collisions with other instances)
   * - Should be deterministic (same inputs → same storeId)
   * - Recommended: Use namespaced format like "issue:123"
   */
  storeId: string

  /**
   * Per-call override for garbage collection time (milliseconds).
   * This instance will remain cached this long after observer count drops to zero.
   * 
   * If multiple observers specify different gcTime values, the longest wins.
   */
  gcTime?: number
}
```

**Behavior:**

1. **On First Call:**
  - Checks registry for existing instance with `(storeDef, storeId)`
  - If not found, loads store asynchronously
  - Suspends component until promise resolves
  - Increments observer ref-count
  - Cancels any pending GC timer

2. **On Subsequent Calls:**
  - Returns cached instance immediately (or suspends if still loading)
  - Increments observer ref-count

3. **On Unmount:**
  - Decrements observer ref-count
  - If count reaches zero, schedules GC timer for `gcTime` milliseconds
  - If component re-mounts before timer fires, timer is cancelled

**Example: Multi-Store Usage**

```tsx
import { useStore } from '@livestore/react'
import { issueStoreDef } from '../stores/issue'
import { issueQuery, issueEvents } from '../stores/issue/queries'

function IssueView({ issueId }: { issueId: string }) {
  // Suspends until issue store is ready
  const issueStore = useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })

  const issue = issueStore.useQuery(issueQuery(issueId))

  function handleUpdateTitle(newTitle: string) {
    issueStore.commit(
      issueEvents.issueTitleUpdated({ issueId, newTitle })
    )
  }

  return (
    <div>
      <h2>Issue: {issue.title}</h2>
      <button onClick={() => handleUpdateTitle('New Title')}>
        Update Title
      </button>
    </div>
  )
}

// Usage with Suspense boundary
function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load issue</div>}>
      <Suspense fallback={<div>Loading issue...</div>}>
        <IssueView issueId="issue-123" />
      </Suspense>
    </ErrorBoundary>
  )
}
```

**Example: Single-Store Usage (Backward Compatible)**

```tsx
import { LiveStoreProvider, useStore } from '@livestore/react'

function App() {
  return (
    <LiveStoreProvider schema={schema} adapter={adapter}>
      <Suspense fallback={<div>Loading...</div>}>
        <MainContent />
      </Suspense>
    </LiveStoreProvider>
  )
}

function MainContent() {
  // No parameters needed for single-store usage
  const store = useStore()
  const data = store.useQuery(myQuery)
  return <div>{data}</div>
}
```

#### `useStoreRegistry()`

Hook to access the `StoreRegistry` instance for advanced operations like preloading (see [Introduce Registry for Multi-Store Support](#introduce-registry-for-multi-store-support)).

**Signature:**

```ts
function useStoreRegistry(override?: StoreRegistry): StoreRegistry
```

**Parameters:**
- `override`: Optional custom registry (useful for testing)

**Returns:**
- The current `StoreRegistry` from context (or the override)

**Throws:**
- Error if called outside `<MultiStoreProvider>` and no override provided

**Example:**

```tsx
import { useStoreRegistry } from '@livestore/react'
import { issueStoreDef } from '../stores/issue'

function IssueListItem({ issueId }: { issueId: string }) {
  const registry = useStoreRegistry()

  const prefetchIssue = () => {
    // Preload the issue store on hover (doesn't suspend this component)
    registry.preloadStore({
      storeDef: issueStoreDef,
      storeId: issueId,
    })
  }

  return (
    <Link
      to={`/issues/${issueId}`}
      onMouseEnter={prefetchIssue}
      onFocus={prefetchIssue}
    >
      Issue {issueId}
    </Link>
  )
}
```

#### `registry.preloadStore()`

Preloads a store instance without suspending the component. Useful for prefetching data on hover, focus, or in route loaders.

**Signature:**

```ts
type PreloadStore = <TSchema extends LiveStoreSchema>(
  options: PreloadStoreOptions<TSchema>
) => Promise<void>
```

**Options:**

```ts
type PreloadStoreOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Store definition to preload.
   */
  storeDef: StoreDefinition<TSchema>

  /**
   * Store instance identifier.
   */
  storeId: string

  /**
   * Optional GC time override.
   */
  gcTime?: number

  /**
   * Optional abort signal to cancel loading if user navigates away.
   */
  signal?: AbortSignal
}
```

**Behavior:**
- Returns immediately if store is already loaded
- Starts loading if not in cache (doesn't suspend caller)
- Returns promise that resolves when loading completes
- Instance still subject to GC if no observers attach

**Example: Prefetch on Hover**

```tsx
function IssueLink({ issueId }: { issueId: string }) {
  const registry = useStoreRegistry()

  const prefetch = () => {
    registry.preloadStore({
      storeDef: issueStoreDef,
      storeId: issueId,
    })
  }

  return (
    <a
      href={`/issues/${issueId}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      View Issue
    </a>
  )
}
```

**Example: Route Loader (React Router)**

```tsx
import { redirect } from 'react-router-dom'

export async function issueLoader({ params, request }: LoaderFunctionArgs) {
  const { issueId } = params
  if (!issueId) return redirect('/issues')

  // Preload store before rendering component
  await registry.preloadStore({
    storeDef: issueStoreDef,
    storeId: issueId,
    signal: request.signal, // Abort if navigation cancelled
  })

  return { issueId }
}
```

**Example: Preload Most Recent Issues**

```tsx
function WorkspaceView() {
  const workspaceStore = useStore({
    storeDef: workspaceStoreDef,
    storeId: 'workspace-root',
  })
  const workspace = workspaceStore.useQuery(workspaceQuery)
  const registry = useStoreRegistry()
  
  const mostRecentIssueIds = workspace.recentIssueIds.slice(0, 20)

  // Preload all issue stores in parallel
  React.useEffect(() => {
    mostRecentIssueIds.forEach((issueId) => {
      registry.preloadStore({ storeDef: issueStoreDef, storeId: issueId })
    })
  }, [workspace.recentIssueIds, registry])

  return <div>{/* ... */}</div>
}
```

#### `registry.drop()`

Manually evict a store instance from the cache, destroying it immediately.

**Signature:**

```ts
function drop<TSchema extends LiveStoreSchema>(
  storeDef: StoreDefinition<TSchema>,
  storeId: string
): void
```

**Behavior:**
- Cancels any pending GC timer
- Aborts store loading if in progress
- Calls `store.destroy()` if instance exists
- Removes from registry cache
- No-op if instance doesn't exist

**Warning:** Only call `drop()` if you're certain no components are using the store. Dropping a store with active observers will cause errors when those components try to access it.

**Example:**

```tsx
function AdminPanel() {
  const registry = useStoreRegistry()

  const handleResetIssue = (issueId: string) => {
    // Force drop the store to clear all cached data
    registry.drop(issueStoreDef, issueId)
    
    // Next useStore() call will load a fresh instance
  }

  return <button onClick={() => handleResetIssue('issue-123')}>Reset</button>
}
```

#### `registry.clear()`

Evicts all store instances from the registry.

**Signature:**

```ts
function clear(): void
```

**Behavior:**
- Calls `drop()` on every cached instance
- Clears the entire registry
- Useful for logout, test cleanup, etc.

**Example:**

```tsx
function LogoutButton() {
  const registry = useStoreRegistry()

  const handleLogout = async () => {
    // Clear all stores before logout
    registry.clear()
    
    await logout()
    navigate('/login')
  }

  return <button onClick={handleLogout}>Logout</button>
}
```

#### Choosing `storeId` Values

The `storeId` is critical for cache key generation. Follow these guidelines:

**✅ Good Patterns:**

```tsx
// Namespace with store type
`issue:${issueId}`
`workspace:${workspaceId}`
`user-profile:${userId}`

// Multi-part keys (deterministic order)
`project:${projectId}:issue:${issueId}`
`org:${orgId}:workspace:${workspaceId}`

// Singleton stores
`workspace-root`
`app-settings`
`current-user`

// Scoped to context
`chat:${conversationId}`
`canvas:${documentId}:layer:${layerId}`
```

**❌ Anti-Patterns:**

```tsx
// ❌ No namespace (collision risk)
issueId  // What if issueId === workspaceId?

// ❌ Non-deterministic
`${Math.random()}`
`${Date.now()}`

// ❌ Overly long (impacts telemetry, storage keys)
`${longUrl}/${manyParams}/${evenMore}...`

// ❌ Special characters needing escaping
`user:email:${email}`  // email might contain : or /

// ❌ User input without sanitization
`search:${userQuery}`  // Injection risk
```

**Guidelines:**

1. **Stable & Deterministic**: Same logical entity → same `storeId` across renders
2. **Globally Unique**: No collisions between different entities or store types
3. **Namespaced**: Prefix with store type to avoid cross-definition conflicts
4. **Short**: Keep under ~120 characters (impacts storage keys, URLs, telemetry)
5. **Sanitized**: Validate/escape user input before using in `storeId`
6. **Documented**: Document special IDs like `"root"` or `"default"` in your codebase

**Decision Matrix:**

| Scenario       | Pattern               | Example               |
|:---------------|:----------------------|:----------------------|
| Single entity  | `type:id`             | `issue:abc-123`       |
| Multi-part key | `type:id1:id2`        | `project:p1:issue:i1` |
| Singleton      | `type-singleton`      | `workspace-root`      |
| User-scoped    | `user:userId:type:id` | `user:u1:settings`    |
| Tenant-scoped  | `org:orgId:type:id`   | `org:acme:workspace`  |

### User-Space Helpers

While `useStore()` provides the core API for accessing stores, applications often benefit from **custom abstractions** that encapsulate common patterns and reduce boilerplate. These helpers build on the generic hook approach (see [Generic `useStore()` Hook vs. Per-Definition Hooks](#generic-usestore-hook-vs-per-definition-hooks)).

#### Pattern 1: Singleton Store Hooks

For stores that logically have only one instance in your application (e.g., current workspace, user settings), create a custom hook that hides the `storeId` management.

**Example: Current Workspace Store**

```tsx
// src/stores/workspace/index.ts
import { useStore } from '@livestore/react'
import { useAuth } from '../../auth'

export const workspaceStoreDef = defineStore({
  name: 'workspace',
  schema: workspaceSchema,
  adapter,
  gcTime: Infinity, // Never evict workspace
})

/**
 * Hook to access the current user's workspace store.
 * By design, our app has a single workspace per organization.
 */
export function useCurrentWorkspaceStore() {
  const { orgId } = useAuth() // Get orgId from auth context
  
  return useStore({
    storeDef: workspaceStoreDef,
    storeId: `workspace:org_${orgId}`,
  })
}

/**
 * Preload function for route loaders.
 */
export async function preloadCurrentWorkspaceStore(
  registry: StoreRegistry,
  orgId: string
) {
  await registry.preloadStore({
    storeDef: workspaceStoreDef,
    storeId: `workspace:org_${orgId}`,
  })
}
```

**Usage:**

```tsx
function WorkspaceView() {
  // Simple API - no storeId needed
  const workspaceStore = useCurrentWorkspaceStore()
  const workspace = workspaceStore.useQuery(workspaceQuery)
  
  return <div>Workspace: {workspace.name}</div>
}
```

#### Pattern 2: Context-Based Store Providers

For stores that are used deeply within a component subtree, create a React Context to avoid prop drilling.

**Example: Issue Store Provider**

```tsx
// src/stores/issue/index.ts
import { createContext, use } from 'react'
import { useStore } from '@livestore/react'

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
  gcTime: 2 * 60_000,
})

// Create context for the issue store
const IssueStoreContext = createContext<Store<typeof issueSchema> | null>(null)

/**
 * Provider component that loads and provides an issue store.
 * This component will suspend while the store is loading.
 */
export function IssueStoreProvider({
  issueId,
  children,
}: {
  issueId: string
  children: React.ReactNode
}) {
  const store = useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })
  
  return (
    <IssueStoreContext.Provider value={store}>
      {children}
    </IssueStoreContext.Provider>
  )
}

/**
 * Hook to access the issue store from context.
 * Must be used within an <IssueStoreProvider>.
 */
export function useIssueStore() {
  const store = use(IssueStoreContext)
  if (!store) {
    throw new Error('useIssueStore must be used within an <IssueStoreProvider>')
  }
  return store
}
```

**Usage:**

```tsx
function IssueDetailPage({ issueId }: { issueId: string }) {
  return (
    <ErrorBoundary fallback={<IssueError />}>
      <Suspense fallback={<IssueLoading />}>
        <IssueStoreProvider issueId={issueId}>
          <IssueHeader />
          <IssueDescription />
          <IssueComments />
        </IssueStoreProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

function IssueHeader() {
  // No need to pass issueId as prop
  const issueStore = useIssueStore()
  const issue = issueStore.useQuery(issueQuery)
  
  return <h1>{issue.title}</h1>
}

function IssueComments() {
  const issueStore = useIssueStore()
  const comments = issueStore.useQuery(commentsQuery)
  
  return <CommentList comments={comments} />
}
```

#### Pattern 3: Router-Integrated Hooks

For stores that correspond to route parameters, create hooks that automatically extract the `storeId` from the router.

**Example: Route-Based Issue Store**

```tsx
// src/stores/issue/index.ts
import { useParams } from 'react-router-dom'
import { useStore } from '@livestore/react'

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
})

/**
 * Hook to access the issue store from the current route.
 * Expects a route like: /issues/:issueId
 */
export function useIssueStoreFromRoute() {
  const { issueId } = useParams<{ issueId: string }>()
  
  if (!issueId) {
    throw new Error('useIssueStoreFromRoute must be used within a route with an :issueId param')
  }
  
  return useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })
}

/**
 * Route loader for React Router.
 */
export async function issueRouteLoader({
  params,
  context,
}: {
  params: { issueId: string }
  context: { registry: StoreRegistry }
}) {
  const { issueId } = params
  const { registry } = context
  
  // Preload the issue store before rendering
  await registry.preloadStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })
  
  return { issueId }
}
```

**Usage:**

```tsx
// Route configuration
const routes = [
  {
    path: '/issues/:issueId',
    loader: issueRouteLoader,
    element: <IssueDetailPage />,
  },
]

// Component
function IssueDetailPage() {
  // Automatically uses issueId from route params
  const issueStore = useIssueStoreFromRoute()
  const issue = issueStore.useQuery(issueQuery)
  
  return <div>{issue.title}</div>
}
```

#### Pattern 4: Parameterized Store Hooks

For stores that need multiple pieces of data to construct the `storeId`, create hooks that accept those parameters.

**Example: Project-Scoped Issue Store**

```tsx
// src/stores/issue/index.ts
import { useStore } from '@livestore/react'

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
})

/**
 * Hook to access an issue store scoped to a specific project.
 * Useful when the same issue ID might exist in different projects.
 */
export function useProjectIssueStore(projectId: string, issueId: string) {
  return useStore({
    storeDef: issueStoreDef,
    storeId: `project:${projectId}:issue:${issueId}`,
  })
}

/**
 * Hook for the current project's issue (uses project from context).
 */
export function useCurrentProjectIssueStore(issueId: string) {
  const { currentProjectId } = useProject()
  
  return useProjectIssueStore(currentProjectId, issueId)
}
```

**Usage:**

```tsx
function IssueView({ issueId }: { issueId: string }) {
  // Automatically scoped to current project
  const issueStore = useCurrentProjectIssueStore(issueId)
  const issue = issueStore.useQuery(issueQuery)
  
  return <div>{issue.title}</div>
}
```

### Store Instance Lifecycle and GC

Understanding the store lifecycle is critical for reasoning about memory usage and performance (see [Automatic Garbage Collection with gcTime](#automatic-garbage-collection-with-gctime)).

#### Instance States

A store instance progresses through these states:

```
┌─────────────────────────────────────────────────────────┐
│                        LOADING                          │
│  • registry.get() called for the first time             │
│  • Promise created, loadStore() in progress             │
│  • Components suspend while waiting                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ loadStore() resolves
                 ▼
┌─────────────────────────────────────────────────────────┐
│                         ACTIVE                          │
│  • Store instance ready                                 │
│  • observers > 0                                        │
│  • Components using useStore() can access it            │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ Last observer unmounts
                 ▼
┌─────────────────────────────────────────────────────────┐
│                        INACTIVE                         │
│  • Store instance ready but not observed                │
│  • observers === 0                                      │
│  • GC timer scheduled for gcTime milliseconds           │
│  • Can transition back to ACTIVE if observer attaches   │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ GC timer fires (or manual drop())
                 ▼
┌─────────────────────────────────────────────────────────┐
│                       DISPOSED                          │
│  • store.destroy() called                               │
│  • Removed from registry                                │
│  • Must reload from scratch if needed again             │
└─────────────────────────────────────────────────────────┘
```

#### Observer Ref-Counting

Each `useStore()` call increments an **observer count**. When the component unmounts, the count decrements.

```tsx
function ComponentA() {
  useStore({ storeDef, storeId: 'issue-1' }) // observers: 0 → 1
  return <div>A</div>
}

function ComponentB() {
  useStore({ storeDef, storeId: 'issue-1' }) // observers: 1 → 2
  return <div>B</div>
}

// If ComponentA unmounts: observers: 2 → 1 (still active)
// If ComponentB unmounts: observers: 1 → 0 (start GC timer)
```

**Key Points:**
- Observer count is per-instance (not per-definition)
- Multiple components can observe the same instance
- GC only starts when count reaches **exactly zero**
- Re-mounting a component before GC fires cancels the timer

#### Garbage Collection Algorithm

```
When observers drop to zero:
  1. Check if gcTime is Infinity
     → YES: Keep instance cached forever
     → NO: Continue

  2. Schedule setTimeout(() => { ... }, gcTime)
  
  3. When timer fires:
     a. Re-check observer count (might have changed)
     b. If still zero, call store.destroy() and remove from cache
     c. If non-zero, do nothing (timer was stale)

When a new observer attaches:
  1. Cancel any pending GC timer
  2. Increment observer count
```

**Example Timeline:**

```
t=0s   : Component mounts → useStore() → observers: 0 → 1
t=10s  : Component unmounts → observers: 1 → 0, schedule GC for t=70s (gcTime=60s)
t=20s  : Another component mounts → useStore() → observers: 0 → 1, cancel GC timer
t=30s  : Component unmounts → observers: 1 → 0, schedule GC for t=90s
t=90s  : GC timer fires, observers still 0 → store.destroy() → removed from cache
```

#### GC Time Configuration Layers

Multiple layers can specify `gcTime`. The effective value is determined by precedence (see [Configuration Cascade](#configuration-cascade-provider--definition--call-site)):

```tsx
// Layer 1: Provider default (lowest priority)
<MultiStoreProvider
  defaultStoreOptions={{ gcTime: 60_000 }}
/>

// Layer 2: Definition default (middle priority)
const issueStoreDef = defineStore({
  name: 'issue',
  schema,
  adapter,
  gcTime: 120_000, // Overrides provider default
})

// Layer 3: Call-site override (highest priority)
useStore({
  storeDef: issueStoreDef,
  storeId: 'issue-1',
  gcTime: 300_000, // Overrides both definition and provider
})
```

**Observer-Specific GC Times:**

If multiple observers specify different `gcTime` values, the longest duration wins (see [Longest `gcTime` Wins When Multiple Observers](#longest-gctime-wins-when-multiple-observers)):

```tsx
// Component A
useStore({ storeDef, storeId: 'issue-1', gcTime: 30_000 }) // 30s

// Component B
useStore({ storeDef, storeId: 'issue-1', gcTime: 120_000 }) // 120s

// When both unmount, GC timer will be 120s (longest)
```

**Rationale:** This ensures late-arriving observers don't get surprised by an early eviction from a short-lived peer.

#### Special GC Values

| Value              | Behavior            | Use Case                            |
|:-------------------|:--------------------|:------------------------------------|
| `Infinity`         | Never auto-dispose  | Singleton stores, critical app data |
| `60_000` (default) | 60 seconds          | Standard UI data                    |
| `0`                | Dispose immediately | Not recommended (causes thrashing)  |

#### SSR Considerations

**Server-Side Default:**

```ts
const DEFAULT_GC_TIME = typeof window === 'undefined'
  ? Number.POSITIVE_INFINITY
  : 60_000
```

**Rationale:**
- On the server, stores are request-scoped
- Setting `gcTime: Infinity` prevents premature disposal during HTML generation
- Streaming SSR: Suspense boundaries may resume after initial render
- Component lifecycle timing is less predictable on server

See [Default `gcTime` of 60 Seconds (Browser) / Infinity (SSR)](#default-gctime-of-60-seconds-browser--infinity-ssr).

### Edge Cases & Limitations

#### Known Limitations

##### 1. No Cross-Store Queries

Each store is fully isolated. You cannot query across store boundaries in a single operation.

**Example:**

```tsx
// ❌ Cannot do this
const result = someStore.useQuery((workspaceStore, issueStore) => {
  return {
    workspace: workspaceStore.data,
    issue: issueStore.data,
  }
})

// ✅ Must do this
const workspaceStore = useStore({ storeDef: workspaceStoreDef, storeId: 'ws-1' })
const issueStore = useStore({ storeDef: issueStoreDef, storeId: 'issue-1' })

const workspace = workspaceStore.useQuery(workspaceQuery)
const issue = issueStore.useQuery(issueQuery)

// Combine in component
const combined = { workspace, issue }
```

**Workaround:**
- Query each store separately
- Combine results in component render
- Or use a parent store that references child IDs

##### 2. `storeId` Must Be String

No support for objects, symbols, or complex keys.

```tsx
// ❌ Not supported
useStore({ storeDef, storeId: { projectId: '1', issueId: '2' } })

// ✅ Serialize to string
useStore({ storeDef, storeId: `project:1:issue:2` })
```

### Migration Guide

#### From Single Store to Multi Store

##### Step 1: Update Dependencies

```bash
npm install @livestore/livestore@latest @livestore/react@latest
```

##### Step 2: Keep Single-Store Usage (No Changes Needed)

Your existing single-store code continues to work unchanged:

```tsx
// ✅ Still works!
<LiveStoreProvider schema={schema} adapter={adapter}>
  <App />
</LiveStoreProvider>
```

##### Step 3: Migrate to Multi-Store (Optional)

If you want to use multiple stores:

**Before:**

```tsx
// app.tsx
<LiveStoreProvider schema={schema} adapter={adapter}>
  <App />
</LiveStoreProvider>

// component.tsx
const store = useStore()
```

**After:**

```tsx
// stores/app/index.ts
export const appStoreDef = defineStore({
  name: 'app',
  schema: schema,
  adapter: adapter,
})

// app.tsx
<MultiStoreProvider defaultStoreOptions={{ ... }}>
  <App />
</MultiStoreProvider>

// component.tsx
const store = useStore({
  storeDef: appStoreDef,
  storeId: 'app-root', // or derive from context
})
```

##### Step 4: Create Store Definitions

Move store configuration to module-level definitions:

```tsx
// stores/workspace/index.ts
import { defineStore } from '@livestore/livestore'
import { workspaceSchema } from './schema'
import { makePersistedAdapter } from '@livestore/adapter-web'

export const workspaceStoreDef = defineStore({
  name: 'workspace',
  schema: workspaceSchema,
  adapter: makePersistedAdapter({ ... }),
  gcTime: 5 * 60_000,
})

// stores/issue/index.ts
export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter: makePersistedAdapter({ ... }),
  gcTime: 2 * 60_000,
})
```

##### Step 5: Update Components

Replace `useStore()` calls with store-specific hooks:

```tsx
// Before
function IssueView({ issueId }) {
  const store = useStore() // Global store
  const issue = store.useQuery(issueQuery(issueId))
  return <div>{issue.title}</div>
}

// After
function IssueView({ issueId }) {
  const issueStore = useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })
  const issue = issueStore.useQuery(issueQuery(issueId))
  return <div>{issue.title}</div>
}
```

##### Step 6: Add Suspense Boundaries

Wrap components that use `useStore()` with Suspense and Error Boundaries:

```tsx
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<LoadingSpinner />}>
    <IssueView issueId="issue-1" />
  </Suspense>
</ErrorBoundary>
```

##### Step 7: Create Helper Hooks (Optional)

Reduce boilerplate with custom hooks:

```tsx
// stores/issue/hooks.ts
export function useIssueStore(issueId: string) {
  return useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })
}

// Usage
function IssueView({ issueId }) {
  const issueStore = useIssueStore(issueId)
  // ...
}
```

## Design Choices

This section documents key design choices and their rationale. **Feedback and alternative perspectives are welcome.**

### Introduce Registry for Multi-Store Support

**Alternatives Considered:**
1. **Registry pattern** (chosen)
2. **Context-per-store pattern**
3. **Hook-based pattern** (no central management)
4. **Global module state**

**Chosen:** Registry pattern (option 1)

**Rationale:**

**Option 1: Registry Pattern (✅ Chosen)**
```tsx
class StoreRegistry {
  get(storeDef, storeId): Promise<Store>
  preloadStore(storeDef, storeId): Promise<void>
  drop(storeDef, storeId): void
  clear(): void
}
```

**Pros:**
- Centralized lifecycle management (GC, ref-counting, caching)
- Framework-agnostic core (reusable in Node.js, tests, CLI)
- Clear ownership model (one place manages all stores)
- Easy to test (mock registry)
- Provides API for advanced operations (preload, drop, clear)
- Familiar pattern (similar to TanStack Query's QueryClient)

**Cons:**
- Additional abstraction layer
- Slightly more API surface

**Option 2: Context-per-Store**
```tsx
<WorkspaceStoreProvider storeId="ws-1">
  <IssueStoreProvider storeId="issue-1">
    <App />
  </IssueStoreProvider>
</WorkspaceStoreProvider>
```

**Pros:**
- Pure React patterns
- No custom registry abstraction

**Cons:**
- Deep nesting with many stores
- No central point for GC or preloading
- Difficult to manage lifecycle across stores
- No way to preload without rendering provider
- Context pollution (one context per store instance)

**Option 3: Hook-Based**
```tsx
const store = useStoreInstance(storeDef, storeId)
// Each hook manages its own lifecycle
```

**Pros:**
- Simple API
- No providers needed

**Cons:**
- No centralized GC (every hook manages its own cache)
- Difficult to share instances across components
- No preloading capability
- Memory leaks likely (no ref-counting)

### Different Provider for Multi-Store (`<MultiStoreProvider>`)

**Alternatives Considered:**
1. **Different Provider**: Introduce `<MultiStoreProvider>` alongside `<LiveStoreProvider>` (chosen)
2. **Reuse Same Provider**: Add optional props to `<LiveStoreProvider>` to enable multi-store mode
3. **Add Another Provider**: Introduce `<StoreRegistryProvider>` that wraps `<LiveStoreProvider>`

**Chosen:** Different Provider (option 1)

**Rationale:**

**Option 1: Different Provider (✅ Chosen)**
```tsx
// Single store
<LiveStoreProvider schema={schema} adapter={adapter}>
  <App />
</LiveStoreProvider>

// Multi store
<MultiStoreProvider defaultStoreOptions={{ ... }}>
  <App />
</MultiStoreProvider>
```

**Pros:**
- Clear intent: name signals different usage patterns
- Zero overhead for single-store users (tree-shaking removes multi-store code)
- No prop confusion (single-store props vs multi-store props)
- Easier to document and understand (two distinct APIs)
- Backward compatible (existing code unchanged)

**Cons:**
- Two providers to learn
- Cannot easily mix single-store and multi-store in same app

**Option 2: Reuse Same Provider**
```tsx
// Single store
<LiveStoreProvider schema={schema} adapter={adapter}>
  <App />
</LiveStoreProvider>

// Multi store
<LiveStoreProvider defaultStoreOptions={{ ... }}>
  <App />
</LiveStoreProvider>
```

**Pros:**
- Single provider to learn
- Could mix single-store and multi-store usage

**Cons:**
- Props become confusing (schema/adapter only for single-store, defaultStoreOptions only for multi-store)
- Bundle includes both code paths even if only using one
- Unclear which mode you're in without reading props carefully
- Migration path less clear

**Option 3: Add Another Provider**
```tsx
// Single store
<LiveStoreProvider schema={schema} adapter={adapter}>
  <App />
</LiveStoreProvider>

// Multi store
<StoreRegistryProvider defaultStoreOptions={{ ... }}>
  <LiveStoreProvider schema={schema} adapter={adapter} storeDef={def} storeId="x">
    <App />
  </LiveStoreProvider>
</StoreRegistryProvider>
```

**Pros:**
- Could compose single-store and multi-store providers

**Cons:**
- Confusing nesting (why two providers for multi-store?)
- More boilerplate
- LiveStoreProvider semantics change when nested in StoreRegistryProvider
- Harder to understand which provider does what

**Trade-offs:**
- ✅ Zero overhead for single-store apps
- ✅ Easier to document
- ⚠️ Two providers to learn (acceptable given clear use case distinction)

### Name it `MultiStoreProvider` vs. Alternatives

**Alternatives Considered:**
1. **`<MultiStoreProvider>`** (chosen)
2. **`<StoreRegistryProvider>`**
3. **`<LiveStoreRegistryProvider>`**
4. **`<LiveStoresProvider>`** (plural)
5. **`<StoreProvider>`** (generic)

**Chosen:** `<MultiStoreProvider>` (option 1)

**Rationale:**

| Name                        | Pros                                                                                                | Cons                                                                                                |
|:----------------------------|:----------------------------------------------------------------------------------------------------|:----------------------------------------------------------------------------------------------------|
| `MultiStoreProvider` ✅      | • Clearly communicates "multiple stores"<br>• Parallel to `LiveStoreProvider` (single)<br>• Concise | • Doesn't mention "registry"                                                                        |
| `StoreRegistryProvider`     | • Names the implementation detail<br>• Technical accuracy                                           | • Less clear about use case<br>• Users don't care about "registry"<br>• Too implementation-focused  |
| `LiveStoreRegistryProvider` | • Consistent with `LiveStoreProvider`<br>• Mentions registry                                        | • Too verbose<br>• "LiveStore" is brand name, not a descriptor                                      |
| `LiveStoresProvider`        | • Plural indicates multiple                                                                         | • Awkward plural<br>• Doesn't clearly convey difference from single-store                           |
| `StoreProvider`             | • Simple and generic                                                                                | • Too generic<br>• Conflicts with common naming patterns<br>• Doesn't distinguish from single-store |

**Additional Considerations:**
- Future extensibility: Name should accommodate potential features beyond just providing a registry (e.g., store orchestration, cross-store events)
- "MultiStore" is user-focused (what it enables) vs. "StoreRegistry" is implementation-focused (how it works)

**Trade-offs:**
- ✅ Clear, concise, user-focused
- ✅ Room for future features
- ⚠️ Hides implementation detail (registry) — acceptable since it's an implementation detail

### Automatic Garbage Collection with `gcTime`

**Alternatives Considered:**
1. **Manual disposal**: User calls `store.destroy()` explicitly
2. **React lifecycle**: Dispose when provider unmounts
3. **Ref-counting + timer**: Dispose after N seconds of inactivity (chosen)

**Chosen:** Ref-counting + timer (option 3)

**Rationale:**
- Balances memory efficiency with performance (avoid reload thrashing)
- Familiar pattern (similar to TanStack Query, RTK Query)
- Allows late-arriving components to reuse cached instances
- Configurable per store type (long-lived vs. short-lived)

**Trade-offs:**
- ✅ Automatic memory management
- ✅ Handles rapid mount/unmount gracefully
- ⚠️ GC timing is approximate (setTimeout delays)
- ⚠️ Users must understand gcTime for tuning

### Longest `gcTime` Wins When Multiple Observers

**Alternatives Considered:**
1. **First observer's gcTime**
2. **Last observer's gcTime**
3. **Shortest gcTime** (most aggressive)
4. **Longest gcTime** (chosen)

**Chosen:** Longest gcTime (option 4)

**Rationale:**
- Conservative approach (avoids surprise evictions)
- Late-arriving observers can extend lifetime
- Prevents short-lived observer from prematurely dropping store used by long-lived observer
- Matches user intuition ("keep it around longer")

**Trade-offs:**
- ✅ Predictable behavior (store stays alive longer than shortest)
- ⚠️ Potentially keeps stores in memory longer than some observers expect

### Default `gcTime` of 60 Seconds (Browser) / Infinity (SSR)

**Alternatives Considered:**
1. **30 seconds** (aggressive eviction)
2. **60 seconds** (chosen for browser)
3. **5 minutes** (longer retention, like TanStack Query)
4. **Infinity** (chosen for SSR, never evict)

**Chosen:** 60 seconds in browser, Infinity during SSR

**Rationale:**
- **60 seconds in browser** balances memory efficiency with user experience:
  - Long enough to avoid thrashing on quick navigation (back/forward)
  - Short enough to prevent excessive memory usage in long-running sessions
  - Shorter than TanStack Query's default (5 minutes) because stores are heavier than query results
- **Infinity during SSR** prevents premature disposal during HTML generation:
  - Server render lifecycle is less predictable (streaming, Suspense boundaries resuming)
  - Request-scoped cleanup happens naturally when request completes
  - Server memory is less constrained than client memory

**Comparison with Other Libraries:**
- **TanStack Query**: `gcTime: 5 minutes` (cache time for query data)
- **RTK Query**: `keepUnusedDataFor: 60 seconds`

### Generic `useStore()` Hook vs. Per-Definition Hooks

**Alternatives Considered:**
1. **Single generic `useStore()` hook** (chosen)
2. **Factory function to create typed hooks** (e.g., `createStoreHooks(storeDef)`)

**Chosen:** Single generic `useStore()` hook (option 1)

**Rationale:**

**Option 1: Generic Hook (✅ Chosen)**
```tsx
// Library provides
const store = useStore({ storeDef: workspaceStoreDef, storeId: 'ws-1' })

// Users can create their own wrappers
export function useWorkspaceStore(workspaceId: string) {
  return useStore({ storeDef: workspaceStoreDef, storeId: workspaceId })
}
```

**Pros:**
- Minimal API surface (one hook to learn)
- No magic or code generation
- Full type safety through TypeScript generics
- Users control their own abstractions (see User-Space Helpers)
- Works with any store definition (even dynamically created ones)
- Simple mental model: "call useStore with the definition you want"
- No additional build step or tooling required

**Cons:**
- Slightly more verbose at call-sites (must specify storeDef and storeId)
- Users must create their own helper hooks for convenience

**Option 2: Factory Function**
```tsx
const workspaceStoreDef = defineStore({ name: 'workspace', ... })
const { useStore: useWorkspaceStore } = createStoreHooks(workspaceStoreDef)

// Later
const store = useWorkspaceStore('ws-1')
```

**Pros:**
- Explicit opt-in to per-definition hooks
- Type-safe (returns properly typed hooks)
- No build step required

**Cons:**
- More API surface (`createStoreHooks`)
- Users must remember to call factory
- Inconsistent patterns (some use generic, some use factory)
- Additional imports to manage
- Not significantly better than user-space wrappers
- Adds ceremony for little benefit

### Suspend on `useStore()` Instead of Render Prop

**Alternatives Considered:**
1. **Render props**: `<StoreLoader render={(store) => ...} />`
2. **Suspense** (chosen)
3. **Status flags**: `const { store, isLoading } = useStore()`

**Chosen:** Suspense (option 2)

**Rationale:**
- Aligns with React 18+ best practices
- Composable with other Suspense-based libraries
- Decouples loading UI from business logic
- Simpler component code (no loading branches)

**Trade-offs:**
- ✅ Modern React patterns
- ✅ Composable with React Router, Next.js, etc.
- ⚠️ Requires React 18+
- ⚠️ Learning curve for users unfamiliar with Suspense
- ⚠️ Differs from existing loading pattern

### Configuration Cascade (Provider → Definition → Call-Site)

**Alternatives Considered:**
1. **Flat**: Only call-site options
2. **Two-level**: Provider + call-site
3. **Three-level**: Provider → Definition → Call-site (chosen)

**Chosen:** Three-level cascade (option 3)

**Rationale:**
- Provider: App-wide policy (auth, telemetry)
- Definition: Store-type policy (workspace = long-lived, issues = short-lived)
- Call-site: Override for specific use case

**Trade-offs:**
- ✅ Flexibility without repetition
- ✅ Clear precedence rules
- ⚠️ More complexity to document
- ⚠️ Potential confusion about which layer wins

## Open Questions

### 1. Should `storeId` Be Optional with a Default in Multi-Store Mode?

**Current:** `storeId` is required.

**Alternative:** Default to `"default"` if omitted.

```tsx
// Current
useStore({ storeDef, storeId: 'default' })

// Alternative
useStore({ storeDef }) // Implicitly storeId: 'default'
```

**Pros:**
- Simpler for singleton stores
- Less boilerplate

**Cons:**
- Encourages lazy patterns (forgetting to specify storeId)
- Risk of unintended singleton behavior
- Hides the fact that multiple instances can exist
- Less explicit (what is the default?)

### 2. How are `clientId` and `sessionId` Managed in Multi-Store?

**Context:**

Many sync adapters require a `clientId` and `sessionId`:
- **`clientId`**: Unique identifier for this device/browser (persisted across sessions)
- **`sessionId`**: Unique identifier for this tab/window

**Question:** In a multi-store environment, how should these IDs kept consistent across store instances?

### 3. How Should We Handle LiveStore Shutdown in Multi-Store Scenarios?

**Context:**

In single-store mode, app shutdown is straightforward—destroy the one store instance. With multiple stores, the shutdown sequence becomes more complex.

**Question:** What's the right shutdown strategy for multi-store environments?

## Appendix

### A. Full Type Definitions

```ts
// Store Definition
type DefineStoreOptions<TSchema extends LiveStoreSchema> = {
  name: string
  schema: TSchema
  adapter: Adapter
  gcTime?: number
  onLoad?: (
    store: Store<TSchema>,
    ctx: { migrationsReport: MigrationsReport; parentSpan: otel.Span }
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}

type StoreDefinition<TSchema extends LiveStoreSchema> = {
  readonly definitionId: string
  readonly name: string
  readonly schema: TSchema
  // Internal fields omitted
}

declare function defineStore<TSchema extends LiveStoreSchema>(
  options: DefineStoreOptions<TSchema>
): StoreDefinition<TSchema>

// Provider
type StoreDefaultOptions = {
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
  gcTime?: number
}

// Hooks
type UseStoreOptions<TSchema extends LiveStoreSchema> = {
  storeDef: StoreDefinition<TSchema>
  storeId: string
  gcTime?: number
}

declare function useStore<TSchema extends LiveStoreSchema>(): Store<TSchema>
declare function useStore<TSchema extends LiveStoreSchema>(
  options: UseStoreOptions<TSchema>
): Store<TSchema>

declare function useStoreRegistry(override?: StoreRegistry): StoreRegistry

// Registry
type PreloadStoreOptions<TSchema extends LiveStoreSchema> = {
  storeDef: StoreDefinition<TSchema>
  storeId: string
  gcTime?: number
  signal?: AbortSignal
}

class StoreRegistry {
  constructor(defaultOptions?: StoreDefaultOptions)

  updateDefaultOptions(options: StoreDefaultOptions): void

  get<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    options: LoadStoreOptions<TSchema>
  ): Promise<Store<TSchema>>

  preloadStore<TSchema extends LiveStoreSchema>(
    options: PreloadStoreOptions<TSchema>
  ): Promise<void>

  retain<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    gcTime?: number
  ): () => void

  release<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    gcOverride?: number
  ): void

  has<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string
  ): boolean

  drop<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string
  ): void

  clear(): void
}
```

### B. Example Application Structure

```
src/
├── stores/
│   ├── workspace/
│   │   ├── index.ts           # Store definition + custom hooks
│   │   ├── schema.ts          # Schema definition
│   │   └── worker.ts          # Dedicated web worker
│   │
│   ├── issue/
│   │   ├── index.ts
│   │   ├── schema.ts
│   │   └── worker.ts
│   │
│   └── user/
│       ├── index.ts
│       ├── schema.ts
│       └── ...
│
├── components/
│   ├── WorkspaceView.tsx      # Uses useStore with workspaceStoreDef
│   ├── IssueView.tsx          # Uses useStore with issueStoreDef
│   └── ...
│
├── App.tsx                    # <MultiStoreProvider>
└── main.tsx                   # ReactDOM.render
```

### C. Implementation Draft

```tsx
import * as React from 'react'

// --- Single Store (Backward Compatible) ---

const DefaultStoreContext = React.createContext<Promise<Store> | null>(null)

type LiveStoreProviderProps<TSchema extends LiveStoreSchema> = React.PropsWithChildren<{
  schema: TSchema
  adapter: Adapter
  storeId?: string
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  abortSignal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
  onLoad?: (
    store: Store<TSchema>,
    ctx: { migrationsReport: MigrationsReport; parentSpan: otel.Span }
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}>

export function LiveStoreProvider<TSchema extends LiveStoreSchema>({
  schema,
  adapter,
  storeId = 'default',
  batchUpdates,
  syncPayload,
  abortSignal,
  otelOptions,
  onLoad,
  children,
}: LiveStoreProviderProps<TSchema>) {
  const storePromise = React.useMemo(
    () =>
      loadStore({
        schema,
        adapter,
        storeId,
        batchUpdates,
        syncPayload,
        abortSignal,
        otelOptions,
        onLoad,
      }),
    [schema, adapter, storeId, batchUpdates, syncPayload, abortSignal, otelOptions, onLoad]
  )

  return <DefaultStoreContext.Provider value={storePromise}>{children}</DefaultStoreContext.Provider>
}

// --- Multi Store ---

const DEFAULT_GC_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

type StoreDefaultOptions = {
  batchUpdates?: (callback: () => void) => void
  syncPayload?: Schema.JsonValue
  otelOptions?: Partial<OtelOptions>
  gcTime?: number
}

type LoadStoreOptions<TSchema extends LiveStoreSchema> = CreateStoreOptions<TSchema>

function loadStore<TSchema extends LiveStoreSchema>(
  options: LoadStoreOptions<TSchema>
): Promise<Store<TSchema>> {
  return createStorePromise(options)
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
  private defaultStoreOptions: StoreDefaultOptions
  private readonly entries = new Map<string, StoreEntry>()

  constructor(defaultStoreOptions: StoreDefaultOptions = {}) {
    this.defaultStoreOptions = { ...defaultStoreOptions }
  }

  updateDefaultOptions(defaultStoreOptions: StoreDefaultOptions = {}) {
    this.defaultStoreOptions = { ...defaultStoreOptions }
  }

  private makeKey<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string
  ): string {
    return `${def.definitionId}\0${storeId}`
  }

  private resolveGcTime<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    override?: number
  ): number {
    if (typeof override === 'number') return override
    if (typeof def.gcTime === 'number') return def.gcTime
    if (typeof this.defaultStoreOptions.gcTime === 'number') return this.defaultStoreOptions.gcTime
    return DEFAULT_GC_TIME
  }

  private scheduleDrop(key: string, delay: number) {
    return setTimeout(() => {
      const latest = this.entries.get(key)
      if (!latest || latest.observers > 0) return
      this.dropByKey(key)
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
    options: LoadStoreOptions<TSchema>
  ): Promise<Store<TSchema>> {
    const { storeId, gcTime: gcOverride, signal, ...rest } = options
    const key = this.makeKey(def, storeId)

    let entry = this.entries.get(key)

    if (entry?.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = undefined
    }

    if (!entry) {
      const computedGcTime = this.resolveGcTime(def, gcOverride)
      const abortController = typeof AbortController === 'undefined' ? null : new AbortController()
      const controllerSignal = signal ?? abortController?.signal
      const loadInput: LoadStoreOptions<TSchema> = {
        ...this.defaultStoreOptions,
        ...rest,
        storeId,
        gcTime: computedGcTime,
        signal: controllerSignal,
      }

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
        .then(() => loadStore(loadInput))
        .then((store) => {
          const current = this.entries.get(key)
          if (!current || current !== entryPlaceholder) {
            try {
              store.destroy?.()
            } catch {
              // Ignore
            }
            return store
          }

          entryPlaceholder.instance = store

          if (
            entryPlaceholder.observers === 0 &&
            entryPlaceholder.gcTime !== Infinity &&
            !entryPlaceholder.gcTimer
          ) {
            entryPlaceholder.gcTimer = this.scheduleDrop(key, entryPlaceholder.gcTime)
          }

          return store
        })
        .catch((error) => {
          if (this.entries.get(key) === entryPlaceholder) {
            this.entries.delete(key)
          }
          throw error
        })
        .finally(() => {
          entryPlaceholder.abortController = null
        })

      entryPlaceholder.promise = promise
      entry = entryPlaceholder

      this.entries.set(key, entry)
    } else if (gcOverride !== undefined) {
      const newBase = this.resolveGcTime(def, gcOverride)
      if (entry.baseGcTime !== newBase) {
        entry.baseGcTime = newBase
        this.updateEntryGcTime(entry)
      }
    }

    if (entry.instance && entry.observers === 0 && entry.gcTime !== Infinity) {
      entry.gcTimer = this.scheduleDrop(key, entry.gcTime)
    }

    return entry.promise
  }

  retain<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    gcOverride?: number
  ) {
    const key = this.makeKey(def, storeId)
    const entry = this.entries.get(key)
    if (!entry) {
      throw new Error(
        `StoreRegistry.retain called before store "${storeId}" for "${def.name}" was loaded.`
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

    return () => this.release(def, storeId, observerGc)
  }

  release<TSchema extends LiveStoreSchema>(
    def: StoreDefinition<TSchema>,
    storeId: string,
    observerGc?: number
  ) {
    const key = this.makeKey(def, storeId)
    const entry = this.entries.get(key)
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
      entry.gcTimer = this.scheduleDrop(key, entry.gcTime)
    }
  }

  async preloadStore<TSchema extends LiveStoreSchema>(
    options: PreloadStoreOptions<TSchema>
  ): Promise<void> {
    const { storeDef, ...loadOptions } = options
    await this.get(storeDef, loadOptions)
  }

  has = <TSchema extends LiveStoreSchema>(storeDef: StoreDefinition<TSchema>, storeId: string) =>
    this.entries.has(this.makeKey(storeDef, storeId))

  drop = <TSchema extends LiveStoreSchema>(storeDef: StoreDefinition<TSchema>, storeId: string) => {
    const key = this.makeKey(storeDef, storeId)
    this.dropByKey(key)
  }

  private dropByKey(key: string) {
    const entry = this.entries.get(key)
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
      // Ignore
    } finally {
      this.entries.delete(key)
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
        // Ignore
      }
    }

    this.entries.clear()
  }
}

const StoreRegistryContext = React.createContext<StoreRegistry | null>(null)

export function MultiStoreProvider(props: {
  defaultStoreOptions?: StoreDefaultOptions
  children: React.ReactNode
}) {
  const registryRef = React.useRef<StoreRegistry | null>(null)

  if (registryRef.current === null) {
    registryRef.current = new StoreRegistry(props.defaultStoreOptions)
  } else {
    registryRef.current.updateDefaultOptions(props.defaultStoreOptions ?? {})
  }

  const registry = registryRef.current

  React.useEffect(() => {
    return () => {
      registry?.clear()
    }
  }, [registry])

  return <StoreRegistryContext.Provider value={registry}>{props.children}</StoreRegistryContext.Provider>
}

export function useStoreRegistry(override?: StoreRegistry): StoreRegistry {
  if (override) return override

  const registry = React.useContext(StoreRegistryContext)
  if (!registry) {
    throw new Error('useStoreRegistry() must be used within <MultiStoreProvider>')
  }

  return registry
}

// --- useStore() ---

type UseStoreOptions<TSchema extends LiveStoreSchema> = {
  storeDef: StoreDefinition<TSchema>
  storeId: string
  gcTime?: number
}

export function useStore<TSchema extends LiveStoreSchema>(): Store<TSchema>
export function useStore<TSchema extends LiveStoreSchema>(
  options: UseStoreOptions<TSchema>
): Store<TSchema>
export function useStore<TSchema extends LiveStoreSchema>(
  options?: UseStoreOptions<TSchema>
): Store<TSchema> {
  // Single-store usage
  if (!options) {
    const defaultStorePromise = React.useContext(DefaultStoreContext)
    if (!defaultStorePromise) {
      throw new Error(
        'useStore() without params must be used within <LiveStoreProvider>. For multi-store usage, use useStore({ storeDef, storeId }) within <MultiStoreProvider>.'
      )
    }
    return React.use(defaultStorePromise)
  }

  // Multi-store usage
  const registry = React.useContext(StoreRegistryContext)
  if (!registry) {
    throw new Error(
      'useStore({ storeDef, storeId }) must be used within <MultiStoreProvider>. For single-store usage, use useStore() without params within <LiveStoreProvider>.'
    )
  }

  const { storeDef, storeId, gcTime, ...restOptions } = options
  const storePromise = registry.get(storeDef, { storeId, gcTime, ...restOptions })
  const store = React.use(storePromise)

  React.useEffect(() => {
    const dispose = registry.retain(storeDef, storeId, gcTime)
    return () => dispose()
  }, [registry, storeDef, storeId, gcTime])

  return store
}
```

### D. Testing Examples

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { StoreRegistry, MultiStoreProvider, useStore } from '@livestore/react'
import { defineStore } from '@livestore/livestore'

describe('StoreRegistry', () => {
  let registry: StoreRegistry
  let testStoreDef: StoreDefinition

  beforeEach(() => {
    registry = new StoreRegistry({ gcTime: 100 })
    testStoreDef = defineStore({
      name: 'test',
      schema: testSchema,
      adapter: mockAdapter,
    })
  })

  it('should cache store instances', async () => {
    const store1 = await registry.get(testStoreDef, { storeId: 'test-1' })
    const store2 = await registry.get(testStoreDef, { storeId: 'test-1' })

    expect(store1).toBe(store2)
  })

  it('should garbage collect after gcTime', async () => {
    const store = await registry.get(testStoreDef, { storeId: 'test-1' })

    // No observers, should GC after 100ms
    await new Promise((r) => setTimeout(r, 150))

    expect(registry.has(testStoreDef, 'test-1')).toBe(false)
  })

  it('should cancel GC if observer attaches', async () => {
    await registry.get(testStoreDef, { storeId: 'test-1' })

    // Wait 50ms (halfway to GC)
    await new Promise((r) => setTimeout(r, 50))

    // Attach observer
    registry.retain(testStoreDef, 'test-1')

    // Wait past GC time
    await new Promise((r) => setTimeout(r, 100))

    // Should still exist
    expect(registry.has(testStoreDef, 'test-1')).toBe(true)
  })
})

describe('useStore', () => {
  it('should suspend until store is ready', async () => {
    const TestComponent = () => {
      const store = useStore({ storeDef: testStoreDef, storeId: 'test-1' })
      return <div>Loaded</div>
    }

    const { queryByText } = render(
      <MultiStoreProvider>
        <React.Suspense fallback={<div>Loading...</div>}>
          <TestComponent />
        </React.Suspense>
      </MultiStoreProvider>
    )

    expect(queryByText('Loading...')).toBeInTheDocument()

    await waitFor(() => {
      expect(queryByText('Loaded')).toBeInTheDocument()
    })
  })
})
```
