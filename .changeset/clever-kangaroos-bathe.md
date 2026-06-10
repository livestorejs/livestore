---
"@livestore/common": patch
---

Rename client-only event sequencing/merge APIs from `isClient` naming to explicit `isClientOnly` naming, and centralize leader-thread filtering through `isClientOnlyEvent`.
