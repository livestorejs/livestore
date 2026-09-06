---
'@livestore/adapter-cloudflare': patch
---

Remove obsolete derived state database pages after successful Cloudflare adapter boot. Preserve current state and the eventlog, and retry failed cleanup on a later boot without blocking the completed store.
