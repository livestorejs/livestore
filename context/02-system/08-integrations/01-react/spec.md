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
| `useClientDocument`    | `useClientDocument.ts`     | Read/update a client document like local state          |
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

## Write Path (`useClientDocument`)

`setState` resolves functional updates against the current ref value,
short-circuits only on reference equality (`===`), then issues a full
`store.commit(table.set(removeUndefinedValues(value), id))` — one
client-only LWW event per `setState` call, no debouncing
(`useClientDocument.ts:137-145`). The first read of a client document seeds
its default row via a `skipRefresh: true` commit to avoid a reactive loop
during render (`client-document-get-query.ts:47-53`; LS.SYS.INT-R06).

## Store Acquisition

`useStore` requests the store from the registry on every render, including
suspended retries, and always passes the result through `React.use`.
`retain()` runs in `useEffect` _after_ the suspension point, accepting a
documented timing-gap race when `unusedCacheTime` is below ~100ms (issue
#916). The returned store is wrapped by
`withReactApi`, which attaches `useQuery`/`useClientDocument`/
`useSyncStatus` as store methods.

## Suspense Contract

Only store loading suspends. `useStore` calls `React.use` exactly once on
every render: an unloaded store passes the registry's loading promise
(suspending the component); a loaded store passes a stable, already-fulfilled
thenable that React reads synchronously, so mounted renders never suspend and
transitions stay committable. That thenable is the loading promise itself
when the hook saw the store load, so a replayed render hands React the
identical thenable it suspended on. Calling `use` unconditionally keeps the hook
idempotent across React's replay of a suspended render, which assumes the
same sequence of `use` calls: later `use` calls keep their thenable slot and
later hooks run under the correct dispatcher.
The registry is authoritative: a currently cached store supersedes the
result React returns for a replayed thenable, and an expired entry yields a
new loading promise on the next retry. Loading errors and calling outside
`<StoreRegistryProvider>` throw (error-boundary path). Query hooks
(`useQuery`, `useClientDocument`, `useSyncStatus`) never suspend: they
compute the initial result synchronously against the loaded store and
subscribe for updates.

Residual window ([#916](https://github.com/livestorejs/livestore/issues/916)):
if the registry entry expires inside React's immediate-replay window and a
new load has started, React returns the first attempt's thenable and the hook
returns the expired store. This window belongs to the registry, not the hook.
