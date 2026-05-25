---
"@livestore/react": patch
---

Fix `useQuery` returning stale results after the underlying `Store` is disposed and recreated with the same `(storeId, clientId, sessionId)`. The `useRcResource` cache is now scoped per `Store` instance via a `WeakMap`, so a replaced store gets a fresh bucket and previously cached `LiveQuery` instances become GC-eligible (#1186).
