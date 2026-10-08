---
'@livestore/common': patch
'@livestore/livestore': patch
---

Keep synchronous local commits consistent with concurrent session reconciliation by yielding only between complete SQLite/model steps. Preserve local edits, journal entries and persisted heads during rebases, and reject terminal admission before materialization. Subscribers may observe complete intermediate prefixes of large upstream batches. Related synchronous-commit coordination issue: https://github.com/livestorejs/livestore/issues/1465.
