---
'@livestore/common': patch
'@livestore/livestore': patch
---

Treat a materializer that returns `void`/`undefined` as a no-op (same as `[]`) instead of reading `.sql` on `undefined` and shutting down the store. Docs no longer claim materializers can return an `Effect`.
