---
"@livestore/adapter-web": patch
"@livestore/common": patch
"@livestore/livestore": patch
---

Store SQLite rollback changesets in a state-database materialization journal instead of embedding them in event metadata. Track the state database head separately so persisted web snapshots resume from the correct cursor after confirmed journal entries are pruned.
