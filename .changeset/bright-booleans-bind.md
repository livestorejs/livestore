---
'@livestore/common': patch
'@livestore/livestore': patch
'@livestore/wa-sqlite': patch
---

Allow raw SQL queries to bind JavaScript booleans by normalizing them to SQLite integers, and distinguish SQLite bind input types from result value types.
