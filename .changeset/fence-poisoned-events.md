---
"@livestore/common": patch
"@livestore/livestore": patch
---

Malformed known canonical events and deterministic materialization failures now
roll back the complete pull batch, preserve the last valid cursor, fence later
propagation, and fail Store lifecycle with a structured `PoisonedEventError`.
