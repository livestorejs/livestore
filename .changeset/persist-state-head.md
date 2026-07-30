---
"@livestore/adapter-cloudflare": patch
"@livestore/adapter-web": patch
"@livestore/common": patch
"@livestore/livestore": patch
---

Persist the state database snapshot head separately from SQLite rollback changesets and use it when restoring persisted web sessions. The new system table changes the compound state-schema hash, so persisted stores select a fresh state database and rebuild it from the eventlog.
