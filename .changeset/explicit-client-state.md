---
'@livestore/common': minor
'@livestore/framework-toolkit': minor
'@livestore/livestore': minor
'@livestore/react': minor
---

Breaking: remove the client-document API and its implicit event, materializer,
query, and first-read write behavior.

`State.SQLite.clientDocument`, `RowQuery`, `useClientDocument`, the
`store.useClientDocument` augmentation, and the client-document setter/helper
types are no longer exported. Define ordinary SQLite tables, client-only
events, materializers, and read-only queries explicitly. Use
`first({ behaviour: 'fallback', fallback })` when a missing row needs an
in-memory default.

Tracked by [livestorejs/livestore#1481](https://github.com/livestorejs/livestore/issues/1481).
