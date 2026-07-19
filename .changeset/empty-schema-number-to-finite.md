---
---

No release impact (Effect-LSP burndown). Migrates `Schema.Number` → `Schema.Finite` (and `Schema.NumberFromString` → `Schema.FiniteFromString`) to clear all 149 `schemaNumber` diagnostics, keeping `Schema.Number` only for the public SQLite `real`-column DEFAULT codec where non-finite values are valid.
