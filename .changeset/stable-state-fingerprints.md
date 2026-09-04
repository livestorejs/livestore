---
'@livestore/common': patch
---

Replace Effect-internal AST hashing for state schemas with a LiveStore-owned canonical descriptor and a synchronous full-width SHA-256 fingerprint. No application schema changes are required. The first open after upgrading intentionally rematerializes state once from the event log.
