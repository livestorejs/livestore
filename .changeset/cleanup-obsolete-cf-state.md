---
'@livestore/adapter-cloudflare': patch
---

Track Cloudflare state database ownership and remove obsolete tracked files after successful boot. Preserve current state, the eventlog and untracked files, including historical orphans. Retry failed cleanup on a later boot without blocking the completed store.
