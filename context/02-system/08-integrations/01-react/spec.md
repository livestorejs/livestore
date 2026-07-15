# React Integration — Spec

This document specifies the React integration
(`packages/@livestore/react`). It builds on
[requirements.md](./requirements.md); the shared toolkit is specified in
[../spec.md](../spec.md).

## Status

Draft.

## Surface

| Hook / export | File | Purpose |
| --- | --- | --- |
| `useStore` | `useStore.ts` | Acquire a store from the registry (suspense-aware boot) |
| `useQuery` | `useQuery.ts` | Subscribe to any queryable; synchronous first read |
| `useClientDocument` | `useClientDocument.ts` | Read/update a client document like local state |
| `useSyncStatus` | `useSyncStatus.ts` | Observe sync/network status |
| `StoreRegistryContext` | `StoreRegistryContext.tsx` | Scope store resolution per subtree |

`useRcResource` (`useRcResource.ts`) implements the reference-counted
resource pattern behind LS.SYS.INT.REACT-R03.

**Maturity: experimental** — `experimental/` (`LiveList`) provides a
virtualized list component driven by live queries; API unstable.

## Suspense Contract

Only store loading suspends. `useStore` calls
`storeRegistry.getOrLoadPromise` on every render: an unloaded store returns
a promise consumed via `React.use` (suspending the component); a cached
store returns synchronously and `React.use` is skipped entirely (this also
keeps React transitions committable). Store loading errors and calling
outside `<StoreRegistryProvider>` throw (error-boundary path). Query hooks
(`useQuery`, `useClientDocument`, `useSyncStatus`) never suspend: they
compute the initial result synchronously against the loaded store and
subscribe for updates.
