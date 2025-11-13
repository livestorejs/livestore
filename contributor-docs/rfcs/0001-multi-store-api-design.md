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

This model works well for applications with uniform data access patterns and limited data sets.

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

1. **✅ Support Multiple Store Types**: Different schemas, adapters, configurations
2. **✅ Support Multiple Instances**: Same type, different data (e.g., issue-1, issue-2)
3. **✅ Dynamic Store IDs**: Store IDs determined at runtime (e.g., from route params)
4. **✅ Automatic Lifecycle Management**: Creation, caching, garbage collection
5. **✅ Type Safety**: Full TypeScript inference from schema to usage
6. **✅ React Integration**: Natural use of Suspense, Error Boundaries, hooks
7. **✅ Framework Agnostic Core**: Core logic reusable outside React (Node.js, CLI, etc.)
8. **✅ Testability**: Easy to create isolated store instances for tests

## Proposed Solution

### Architecture Overview

The multi-store architecture introduces three key concepts:

```
┌────────────────────────────────────────────────────────────────┐
│                    <StoreRegistryProvider>                     │
│  • Provides StoreRegistry                                      │
│  • Lives at application root                                   │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ provides
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                         StoreRegistry                          │
│  • Central registry for all store instances                    │
│  • Passes default store options (gcTime, syncPayload, etc.)    │
│  • Manages caching, ref-counting, garbage collection           │
│  • Cache key: storeId                                          │
│  • Framework-agnostic (reusable outside React)                 │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ manages
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                         Store Instances                        │
│                                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ storeId:123     │  │ storeId:456     │  │ storeId:789    │  │
│  │ observers: 2    │  │ observers: 1    │  │ observers: 0   │  │
│  │ gcTimeout: null │  │ gcTimeout: null │  │ gcTimeout: 60s │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

> [!NOTE]
> The multi-store API design draws inspiration from [TanStack Query](https://tanstack.com/query), particularly its approach to managing multiple query through a central client cache with automatic garbage collection and its Query Options API.

### API

| API                       | Purpose                                   | Example                                                        |
|:--------------------------|:------------------------------------------|:---------------------------------------------------------------|
| `storeOptions()`          | Define re-usable store options            | `storeOptions({ storeId: 'workspace-root', schema, adapter })` |
| `new StoreRegistry()`     | Create store registry instance            | `new StoreRegistry({ defaultOptions: { ... } })`               |
| `<StoreRegistryProvider>` | StoreRegistry provider                    | `<StoreRegistryProvider storeRegistry={registry}>`             |
| `useStore()`              | Get store instance (suspends until ready) | `useStore(storeOptions)`                                       |
| `useStoreRegistry()`      | Get registry for advanced operations      | `useStoreRegistry()`                                           |
| `registry.preload()`      | Preload store                             | `await registry.preload(storeOptions)`                         |

#### `storeOptions()`

Helper to define re-usable store option that can be later be passed to `useStore()` or `storeRegistry.preload()` while preserving type inference and type safety. At runtime, this helper just returns whatever you pass into it.

**Signature:**

```ts
function storeOptions<TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>
): StoreOptions<TSchema>
```

**Example (Singleton Store):**

```tsx
// src/stores/workspace/index.ts
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react'
import { schema, workspaceEvents, workspaceTables } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const workspaceStoreOptions = storeOptions({
  storeId: 'workspace-root',
  schema,
  adapter,
  gcTime: Infinity,
  boot: (store) => {
    console.log('Workspace store loaded')
  },
})
```

**Example (Multi-Instance Store):**

```tsx
// src/stores/issue/index.ts
import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react'
import { issueEvents, issueTables, schema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter,
    gcTime: 20_000,
  })
```

#### `new StoreRegistry()`

Instantiates the registry that coordinates caching, ref-counting, garbage collection and provides default options to all store instances.

**Example:**

```tsx
import { StoreRegistry } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

const storeRegistry = new StoreRegistry({
  defaultOptions: {
    batchUpdates,
    disableDevtools: false,
    confirmUnsavedChanges: true,
    syncPayload: { authToken: 'insecure-token-change-me' },
  },
})
```

#### `<StoreRegistryProvider>`

Supplies a `StoreRegistry` instance to descendants via context.

**Example:**

```tsx
import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'


export default function App({ children }: { children: React.ReactNode }) {
  const [storeRegistry] = useState(() => new StoreRegistry())
  
  return <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
}
```

#### `useStore()`

Suspense-focused hook that returns a loaded store or triggers Suspense while the store loads.

**Signature:**

```ts
function useStore<TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>
): Store<TSchema> & ReactApi
```

**Example:**

```tsx
import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { issueStoreOptions } from '@/stores/issue'
import { issueTables } from '@/stores/issue/schema.ts'

export function IssuePanel({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreOptions(issueId))
  const [issue] = issueStore.useQuery(queryDb(issueTables.issue.select().limit(1)))
  
  return <h2>{issue.title}</h2>
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
- Error if called outside `<StoreRegistryProvider>` and no override provided

#### `registry.preload()`

Preloads a store instance without suspending the component. It silently discards errors. Useful for preloading on hover, focus, or in route loaders.

**Signature:**

```ts
type PreloadStore = <TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>
) => Promise<void>
```

**Behavior:**

- Return immediately if the store is already loaded/cached
- Starts loading if not in cache
- Returns promise that resolves when loading completes
- Silently discards errors
- Instance still subject to GC if no observers attach

**Example: Preload on Hover**

```tsx
function IssueLink({ issueId }: { issueId: string }) {
  const storeRegistry = useStoreRegistry()

  const preloadIssue = (issueId: string) => {
    storeRegistry.preload({
      ...issueStoreOptions(issueId),
      gcTime: 5_000,
    })
  }

  return (
    <a
      href={`/issues/${issueId}`}
      onMouseEnter={preload}
      onFocus={preload}
    >
      View Issue
    </a>
  )
}
```

**Example: Route Loader**

```tsx
export async function RouteLoader({ params, context }) {
  // Preload store before rendering component
  context.storeRegistry.preload(issueStoreOptions(params.issueId))
}
```

**Example: Preload Most Recent Issues**

```tsx
function WorkspaceView() {
  const workspaceStore = useStore(workspaceStoreOptions)
  const [workspace] = workspaceStore.useQuery(workspaceQuery)
  const storeRegisty = useStoreRegistry()
  
  const mostRecentIssueIds = workspace.recentIssueIds.slice(0, 20)

  // Preload most recent issues' stores
  React.useEffect(() => {
    mostRecentIssueIds.forEach((issueId) => {
      storeRegistry.preload(issueStoreOptions(issueId))
    })
  }, [mostRecentIssueIds, storeRegisty])

  return <div>{/* ... */}</div>
}
```

#### Choosing `storeId` Values

The `storeId` is critical for cache key generation. Follow these guidelines:

**✅ Good Patterns:**

```tsx
// Namespace with store type
`issue-${issueId}`
`workspace-${workspaceId}`
`user-current`

// Multi-part keys (deterministic order)
`project-${projectId}-issue-${issueId}`
`org-${orgId}-workspace-${workspaceId}`

// Singleton stores
`workspace-root`
`app-settings`

// Scoped to context
`chat-${conversationId}`
`canvas-${documentId}-layer-${layerId}`
```

**❌ Anti-Patterns:**

```tsx
// ❌ No namespace (collision risk)
issueId  // What if issueId === workspaceId?

// ❌ Non-deterministic
`${Math.random()}`
`${Date.now()}`

// ❌ Overly long (impacts telemetry, storage keys)
`${longUrl}-${manyParams}-${evenMore}...`

// ❌ Special characters needing escaping
`user-email-${email}`  // email might contain : or /

// ❌ User input without sanitization
`search-${userQuery}`  // Injection risk
```

**Guidelines:**

1. **Stable & Deterministic**: Same logical entity → same `storeId` across renders
2. **Globally Unique**: No collisions between different entities or store types
3. **Namespaced**: Prefix with store type to avoid cross-definition conflicts
4. **Short**: Keep under ~120 characters (impacts storage keys, URLs, telemetry)
5. **Sanitized**: Validate/escape user input before using in `storeId`
6. **Documented**: Document special IDs like `"root"` or `"default"` in your codebase

**Decision Matrix:**

| Scenario       | Pattern               | Example                     |
|:---------------|:----------------------|:----------------------------|
| Single entity  | `type-id`             | `issue-abc123`              |
| Multi-part key | `type-id1-id2`        | `project-p1-issue-i1`       |
| Singleton      | `type-singleton`      | `workspace-root`            |
| User-scoped    | `user-userId-type-id` | `user-u1-settings`          |
| Tenant-scoped  | `org-orgId-type-id`   | `org-acme-workspace`        |


### Store Lifecycle and GC

Understanding the store lifecycle is critical for reasoning about memory usage and performance (see [Automatic Garbage Collection with gcTime](#automatic-garbage-collection-with-gctime)).

A store progresses through these states:

```
┌─────────────────────────────────────────────────────────┐
│                        LOADING                          │
│  • registry.read() called for the first time            │
│  • Promise created, store loading                       │
│  • Components suspend while store loads                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ Store loaded
                 ▼
┌─────────────────────────────────────────────────────────┐
│                         ACTIVE                          │
│  • Store ready                                          │
│  • observers > 0                                        │
│  • Components using useStore() can access it            │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ Last observer unmounts
                 ▼
┌─────────────────────────────────────────────────────────┐
│                        INACTIVE                         │
│  • Store cached but not observed                        │
│  • observers === 0                                      │
│  • GC timer scheduled for `gcTime` milliseconds         │
|  • May transition back to ACTIVE if observer attaches   │
│  • Re-activation cancels pending GC                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ GC timer fires
                 ▼
┌─────────────────────────────────────────────────────────┐
│                       DISPOSED                          │
│  • store.shutdown() called                              │
│  • Removed from registry cache                          │
│  • Must reload from scratch if needed again             │
└─────────────────────────────────────────────────────────┘
```

### Configuration Layers

Two layers define an effective store's configuration.

```tsx
// Registry default (lowest priority)
const registry = new StoreRegistry({
  defaultOptions: { gcTime: 60_000 },
})

// Call-site override (highest priority)
const store = useStore({
  storeId: 'issue-1',
  schema,
  adapter,
  gcTime: 120_000, // Overrides registry default
})
```

**Observer-Specific GC Times:**

If multiple observers specify different `gcTime` values, the longest duration wins:

```tsx
// Component A
useStore({...issueStoreOptions('issue-1'), gcTime: 30_000 }) // 30s

// Component B
useStore({...issueStoreOptions('issue-1'), gcTime: 120_000 }) // 120s

// When both unmount, GC timer will be 120s (longest)
```

During runtime the longest `gcTime` wins when multiple observers pass different options for the same `storeId`. This mirrors the behaviour in the examples where the workspace store disables GC (`Infinity`) while issue stores use shorter windows.

**Rationale:** This ensures late-arriving observers don't get surprised by an early eviction from a short-lived peer (see [Longest `gcTime` Wins When Multiple Observers](#longest-gctime-wins-when-multiple-observers)).

### SSR Considerations

**Scope Stores to Requests:**

Each server request should create its own `StoreRegistry` instance to ensure stores are request-scoped and do not leak between requests.

```tsx
// ❌ Do not instantiate StoreRegistry at module scope
const storeRegistry = new StoreRegistry() // Bad: shared across requests

// ✅ Instantiate per request
export default function App({ children }) {
  const [storeRegistry] = useState(() => new StoreRegistry()) // Good: new instance per request
  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      {children}
    </StoreRegistryProvider>
  )
}
```

**Default GC Time:**

On the server, the default `gcTime` is promoted to `Number.POSITIVE_INFINITY` to prevent premature disposal during HTML generation.

```ts
const DEFAULT_GC_TIME = typeof window === 'undefined'
  ? Number.POSITIVE_INFINITY
  : 60_000
```


See [Default `gcTime` of 60 Seconds (Browser) / Infinity (SSR)](#default-gctime-of-60-seconds-browser--infinity-ssr).

### Limitations

#### 1. No Cross-Store Queries

Each store remains fully isolated. There is no supported way to query across store boundaries in a single operation.

```tsx
// ❌ Cannot combine stores inside a single query invocation
const result = someStore.useQuery((workspaceStore, issueStore) => ({
  workspace: workspaceStore.data,
  issue: issueStore.data,
}))

// ✅ Query each store independently
const workspaceStore = useStore(workspaceStoreOptions)
const issueStore = useStore(issueStoreOptions('issue-1'))

const [workspace] = workspaceStore.useQuery(workspaceQuery)
const [issue] = issueStore.useQuery(issueQuery)

// Combine data at the component layer
const combined = { workspace, issue }
```

## Design Choices

This section documents key design choices and their rationale. **Feedback and alternative perspectives are welcome.**

### Introduce Registry for Multi-Store Support

**Alternatives Considered:**
1. **Registry pattern** (chosen)
2. **Context-per-store pattern**
3. **Hook-based pattern** (no central management)

**Chosen:** Registry pattern (option 1)

**Rationale:**

**Option 1: Registry Pattern (✅ Chosen)**
```tsx
export default function App({ children }) {
  const [storeRegistry] = useState(() => new StoreRegistry()) // Good: new instance per request
  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      {children}
    </StoreRegistryProvider>
  )
}
```

**Pros:**
- Centralized lifecycle management (GC, ref-counting, caching)
- Framework-agnostic core (reusable in Node.js, tests, CLI)
- Clear ownership model (one place manages all stores)
- Easy to test (mock registry)
- Provides API for advanced operations (preload, clear)
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
- No custom registry abstraction

**Cons:**
- Deep nesting with many stores
- No central point for GC or preloading
- Difficult to manage lifecycle across stores
- Easy to forget to remove unused providers
- No way to preload without rendering provider
- Context pollution (one context per store type)

**Option 3: Hook-Based**
```tsx
const store = useStore({ storeId: 'issue-1', schema, adapter })
// Each hook manages its own lifecycle
```

**Pros:**
- Simple API
- No providers needed

**Cons:**
- No centralized GC (every hook manages its own cache)
- Difficult to share store instances across components
- No preloading capability

### Automatic Garbage Collection with `gcTime`

**Alternatives Considered:**
1. **Manual disposal**: User calls `store.destroy()` explicitly
2. **React lifecycle**: Dispose when provider unmounts
3. **Ref-counting + GC**: Dispose after N seconds of inactivity (chosen)

**Chosen:** Ref-counting + GC (option 3)

**Rationale:**
- Balances memory efficiency with performance (avoid reload thrashing)
- Familiar pattern (similar to TanStack Query, RTK Query)
- Allows late-arriving components to reuse cached stores

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

**Trade-offs:**
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
- **Infinity during SSR** prevents premature disposal during HTML generation

**Comparison with Other Libraries:**
- **TanStack Query**: `gcTime: 5 minutes` (cache time for query data)
- **RTK Query**: `keepUnusedDataFor: 60 seconds` (cache time for query data)

## Open Questions

### 1. How Should We Reconcile The Single Store API With Multi-Store?

**Context:**

The existing single-store API uses `<LiveStoreProvider>` and `useStore()` without parameters. With multi-store support, `useStore()` requires options to identify which store to load.

**Question:** Should we deprecate the single-store API in favor of multi-store, or maintain both? If maintaining both, how to clearly distinguish them?

### 2. Which Store Options Should Be Available at Each Layer and How Should Values Merge?

**Context:**

We have a two-layer configuration cascade for configuring store options:

1. **Registry Layer** (`new StoreRegistry({ defaultOptions: { ... } })`)
2. **Call-Site Layer** (`useStore({ ... })`)

We still need to validate which knobs belong where (e.g., should `batchUpdates` ever vary at call-site?). We also need clearer merge semantics for nested objects like `otelOptions`.

| Configuration           | Type               | Registry | Call-Site | Merging Strategy    |
|:------------------------|:-------------------|:---------|:----------|:--------------------|
| `gcTime`                | number             | ✅        | ✅         | Call-site overrides |
| `batchUpdates`          | function           | ✅        | ❌         | -                   |
| `syncPayload`           | object (data)      | ❓        | ❓         | ❓                   |
| `otelOptions`           | object (instances) | ❓        | ❓         | ❓                   |
| `disableDevtools`       | boolean            | ✅        | ✅         | Call-site overrides |
| `confirmUnsavedChanges` | boolean            | ✅        | ✅         | Call-site overrides |
| `debug`                 | object (data)      | ✅        | ✅         | Deep merge          |
| `boot`                  | function           | ❌        | ✅         | -                   |
| `schema`                | object             | ❌        | ✅         | -                   |
| `adapter`               | object (instance)  | ❌        | ✅         | -                   |
| `signal`                | object (instance)  | ❌        | ✅         | -                   |

### 3. How are `clientId` and `sessionId` Managed in Multi-Store?

**Context:**

- **`clientId`**: Unique identifier for this device/browser (persisted across sessions)
- **`sessionId`**: Unique identifier for this tab/window

**Question:** In a multi-store environment, how should these IDs kept consistent across store instances?

### 4. How Should We Handle LiveStore Shutdown in Multi-Store Scenarios?

**Context:**

In single-store mode, app shutdown is straightforward—destroy the one store instance. With multiple stores, the shutdown sequence becomes more complex.

**Question:** What's the right shutdown strategy for multi-store environments?

## Acknowledgments

Special thanks to:

- The [TanStack Query](https://tanstack.com/query) team for their work on client-side state management patterns, particularly the Query Options API and automatic garbage collection approach that inspired this design.
- [@marceloclp](https://github.com/marceloclp), [@slashv](https://github.com/slashv), [@joodaloop](https://github.com/joodaloop), and [@drowrin](https://github.com/drowrin) for their valuable feedback and insights during the design phase.

## Appendix

### A. Application Structure Example

```
src/
├── stores/
│   ├── workspace/
│   │   ├── index.ts           # Store options + custom hooks
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
│   ├── WorkspaceView.tsx      # Uses useStore() with workspaceStoreOptions
│   ├── IssueView.tsx          # Uses useStore() with issueStoreOptions
│   └── ...
│
├── App.tsx                    # <StoreRegistryProvider>
└── ...
```

### B. Type Definitions

```ts
declare function storeOptions<TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>
): StoreOptions<TSchema>;


type StoreRegistryOptions = {
  readonly defaultOptions?: Readonly<Partial<StoreOptions>>;
};

declare class StoreRegistry {
  constructor(options?: StoreRegistryOptions);
  
  preload<TSchema extends LiveStoreSchema>(
    options: StoreOptions<TSchema>
  ): Promise<void>;
  
  clear(): Promise<void>;
}

type StoreRegistryProviderProps = {
  readonly storeRegistry: StoreRegistry;
  readonly children: React.ReactNode;
};

declare function StoreRegistryProvider(
  props: StoreRegistryProviderProps
): React.ReactElement;

declare function useStoreRegistry(override?: StoreRegistry): StoreRegistry;

declare function useStore<TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>
): Store<TSchema> & ReactApi
```

### C. Complete Usage Example

```tsx
import { useState, useMemo, Suspense } from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import {
  StoreRegistry,
  StoreRegistryProvider,
  useStoreRegistry,
  useStore,
  storeOptions,
} from "@livestore/react";
import {
  workspaceSchema,
  workspaceAdapter,
  workspaceEvents,
  selectWorkspaceQuery,
  selectWorkspaceIssueIdsQuery,
} from "./workspace";
import {
  issueSchema,
  issueAdapter,
  issueEvents,
  selectIssueQuery,
} from "./issue";


// Workspace store (singleton)
export const workspaceStoreOptions = storeOptions({
  storeId: "workspace-root",
  schema: workspaceSchema,
  adapter: workspaceAdapter,
  gcTime: Number.POSITIVE_INFINITY, // Disable garbage collection
  boot: (store) => {
    // Callback triggered when the store is first loaded
  },
});

// Issue store (multi-instance)
export const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema: issueSchema,
    adapter: issueAdapter,
    gcTime: 20_000,
    boot: (issueStore) => {
      // Callback triggered when the store is first loaded
    },
  });

function App({ children }: { children: React.ReactNode }) {
  const [storeRegistry] = useState(
    () =>
      new StoreRegistry({
        defaultOptions: {
          batchUpdates,
          syncPayload: { authToken: "insecure-token-change-me" },
        },
      }),
  );

  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      {children}
    </StoreRegistryProvider>
  );
}

type RouterLoaderContext = {
  storeRegistry: StoreRegistry;
};

export async function RouteLoader({ context }: { context: RouterLoaderContext }) {
  context.storeRegistry.preload(workspaceStoreOptions);
}

export default function Route() {
  const workspaceStore = useStore(workspaceStoreOptions); // Suspends
  const [workspace] = workspaceStore.useQuery(selectWorkspaceQuery);
  const issueIds = workspaceStore.useQuery(selectWorkspaceIssueIdsQuery(workspace.id));

  const createIssue = () => {
    workspaceStore.commit(
      workspaceEvents.issueCreated({ title: `Issue ${issueIds.length + 1}` }),
    );
  };

  const [selectedIssueId, setSelectedIssueId] = useState<string>();

  const storeRegistry = useStoreRegistry();
  const preloadIssue = (issueId: string) =>
    storeRegistry.preload({
      ...issueStoreOptions(issueId),
      gcTime: 5 * 1000,
    });

  return (
    <>
      <h1>{workspace.name}</h1>
      <button onClick={createIssue}>Create Issue</button>
      {issueIds.map((id) => (
        <button
          key={id}
          onMouseEnter={() => preloadIssue(id)}
          onClick={() => setSelectedIssueId(id)}
        >
          Select issue {id}
        </button>
      ))}
      {selectedIssueId && (
        <Suspense fallback={<>Loading issue…</>}>
          <IssuePanel issueId={selectedIssueId} />
        </Suspense>
      )}
    </>
  );
}

function IssuePanel({ issueId }: { issueId: string }) {
  const issueStore = useStore({
    ...issueStoreOptions(issueId),
    gcTime: 5 * 1000, // Override gcTime
  }); // Suspends
  const [issue] = issueStore.useQuery(selectIssueQuery(issueId));

  const toggleStatus = () => {
    issueStore.commit(
      issueEvents.issueStatusChanged({
        id: issue.id,
        status: issue.status === "done" ? "todo" : "done",
      }),
    );
  };

  return (
    <>
      <button onClick={toggleStatus}>Toggle status</button>
      <p>{issue.status}</p>
    </>
  );
}
```
