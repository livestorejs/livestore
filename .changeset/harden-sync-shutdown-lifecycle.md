---
"@livestore/common": patch
"@livestore/livestore": patch
"@livestore/adapter-web": patch
---

Hardened client-to-leader synchronization across rebases, worker RPC boundaries, and shutdown. Leader pushes are now acknowledged only after durable processing, repeated rebase recovery preserves pending event order, worker failures remain scoped to their request, and concurrent shutdown callers share one cleanup operation without cancelling cleanup after the wait timeout.
