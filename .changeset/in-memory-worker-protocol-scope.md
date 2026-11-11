---
'@livestore/adapter-web': patch
---

Keep the optional in-memory adapter DevTools shared-worker connection alive until the store scope closes instead of releasing it immediately after RPC client creation. See [#1710](https://github.com/livestorejs/livestore/issues/1710).
