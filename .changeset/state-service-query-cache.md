---
'@livestore/livestore': patch
---

Discard cached query results when a materialization-journal or savepoint rollback changes the session database, and keep the state services' SQL out of duplicate trace spans.
