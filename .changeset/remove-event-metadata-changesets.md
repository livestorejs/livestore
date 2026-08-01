---
"@livestore/adapter-web": patch
"@livestore/common": patch
"@livestore/livestore": patch
---

Stop carrying SQLite rollback changesets in internal event metadata. Persisted state snapshots use their `StateHead`, while leader and client rebases read changesets records from their local materialization journals.
