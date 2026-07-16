---
"@livestore/common": patch
"@livestore/livestore": patch
---

Hardened client-to-leader synchronization across rebases and shutdown. Leader pushes are now acknowledged only after durable processing, repeated rebase recovery preserves pending event order, and concurrent shutdown callers share one cleanup operation without cancelling cleanup after the wait timeout.
