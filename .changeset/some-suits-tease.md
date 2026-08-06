---
"@livestore/sync-cf": patch
---

Persist the sync backend's DO-RPC subscriber registry in the Durable Object's KV storage (`ctx.storage.kv`), keyed by client Durable Object id, so live updates keep flowing to Durable-Object-resident clients after the backend is evicted and rebuilt (deploy, eviction, hibernation). Previously the registry lived only in memory and was lost on reconstruction, silently stopping live sync over DO-RPC and dropping the push echo that can wedge a replica (#1462). WebSocket clients were unaffected; no config or migration is required.
