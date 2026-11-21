---
'@livestore/common': patch
---

Persist each leader sync transition through a dedicated `LeaderPersistence` service. Rollback, materialization, journal maintenance, heads and eventlog inserts commit together, and backend heads persist in the same eventlog transaction as their event inserts.
