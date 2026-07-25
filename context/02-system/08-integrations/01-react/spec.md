# React Integration — Spec

This document specifies the React integration
(`packages/@livestore/react`). It builds on
[requirements.md](./requirements.md); the shared toolkit is specified in
[../spec.md](../spec.md).

## Status

Draft.

## Surface

| Hook / export          | File                       | Purpose                                                 |
| ---------------------- | -------------------------- | ------------------------------------------------------- |
| `useStore`             | `useStore.ts`              | Acquire a store from the registry (suspense-aware boot) |
| `useQuery`             | `useQuery.ts`              | Subscribe to any queryable; synchronous first read      |
| `useSyncStatus`        | `useSyncStatus.ts`         | Observe sync/network status                             |
| `StoreRegistryContext` | `StoreRegistryContext.tsx` | Scope store resolution per subtree                      |

`useRcResource` (`useRcResource.ts`) implements the reference-counted
resource pattern behind LS.SYS.INT.REACT-R03: caches are bucketed in a
module `WeakMap` keyed by Store instance (fresh bucket after store dispose,
issue #1186), rc increments in `useMemo` and decrements in the `useEffect`
cleanup, and a `didDisposeInMemo` flag reconciles StrictMode's double
`useMemo` invocation with in-render key changes.

**Maturity: experimental** — `experimental/` (`LiveList`) provides a
virtualized list component driven by live queries; API unstable.

## Subscription Model

The binding does **not** use `useSyncExternalStore`. `useQuery` holds the
value in a ref and forces re-renders on change
(`useStateRefWithReactiveInput`); renders read `valueRef.current`.
Subscription happens in `useEffect` with a `deepEqual` gate before
`setValue`, so identical results never re-render (`useQuery.ts:107-135`).
Two `useRcResource` calls per query defer instance disposal past the
subscription switch. Consequence: updates are commit-atomic and deduped,
but the ref+effect model is not structurally tear-proof under concurrent
rendering (LS.SYS.INT.REACT-R04 flags this as unverified; issue #1422).

## Store Acquisition

`useStore` calls `storeRegistry.getOrLoadPromise` on every render,
deliberately un-memoized so React transitions stay committable; `retain()`
runs in `useEffect` _after_ `React.use` to keep hook order stable across
suspensions, accepting a documented timing-gap race when `unusedCacheTime`
is below ~100ms (issue #916). The returned store is wrapped by
`withReactApi`, which attaches `useQuery` and `useSyncStatus` as store
methods.

## Suspense Contract

Only store loading suspends. `useStore` calls
`storeRegistry.getOrLoadPromise` on every render: an unloaded store returns
a promise consumed via `React.use` (suspending the component); a cached
store returns synchronously and `React.use` is skipped entirely (this also
keeps React transitions committable). Store loading errors and calling
outside `<StoreRegistryProvider>` throw (error-boundary path). Query/status
hooks (`useQuery`, `useSyncStatus`) never suspend: they
compute the initial result synchronously against the loaded store and
subscribe for updates.
