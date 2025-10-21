# Multi-Store App

This example demonstrates the `createStoreContext` API for managing multiple LiveStore instances in a React application, now running on top of TanStack Start for full-stack routing and SSR.

## Patterns

The app showcases four multi-store patterns:

### Independent
**Independent · Different Types · Separate Loading**

Shows completely independent stores of different types loading concurrently with separate Suspense boundaries.

### Multi-Instance
**Independent · Same Type · Shared Loading**

Shows multiple instances of the same store type loading concurrently with a shared Suspense boundary.

### Chained
**Dependent · Different Types · Separate Loading**

Shows nested stores of different types (Workspace → Issue) where the inner store depends on outer store data and loads separately with its own Suspense boundary.

### Recursive
**Dependent · Same Type · Shared Loading**

Shows nested stores of the same type (Issue → Sub-Issue) to demonstrate recursive relationships with a shared Suspense boundary.

## Key Implementation Details

- **Store Contexts**: Each store type (workspace, issue) has its own context created with `createStoreContext`
- **Suspense Integration**: Each provider suspends until the store is ready, using React Suspense boundaries
- **Error Boundaries**: Errors during store initialization are caught by React Error Boundaries
- **Multi-Instance Access**: Components can access specific store instances using `useIssueStore({ storeId: 'instance-id' })`. `useStore()` without an ID accesses the store from the closest provider of the same type.

## Routing

- Direct links are available for every demo: `/independent`, `/multi-instance`, `/chained`, and `/recursive`.
- The TanStack Start router context exposes the shared `storeRegistry`, making it accessible from route loaders for future preloading or diagnostics work.
- SSR is disabled globally (`defaultSsr: false` and per-route `ssr: false`) so the example runs entirely on the client, avoiding worker initialization during server execution.

## File Structure (TanStack Start)

```
src/
├── routes/
│   ├── __root.tsx         # Document shell + MultiStoreProvider + shared layout
│   ├── chained.tsx        # Chained demo route
│   ├── independent.tsx    # Independent demo route
│   ├── index.tsx          # Redirect preserves legacy /
│   ├── multi-instance.tsx # Multi-instance demo route
│   └── recursive.tsx      # Recursive demo route
├── components/           # Shared views (IssueView, WorkspaceView, etc.)
├── stores/               # LiveStore schemas, workers, and store APIs
├── router.ts             # Router factory that wires `routeTree.gen.ts`
├── routeTree.gen.ts      # Auto-generated TanStack route tree (keep synced)
├── styles.css            # Global styles
└── ambient.d.ts          # Vite client typings
```
