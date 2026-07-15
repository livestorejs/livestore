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

## Open Design Questions

- **LS.SYS.INT.REACT-DQ1 Suspense contract.** Which operations may suspend
  (store boot vs first query) should be stated testably.
