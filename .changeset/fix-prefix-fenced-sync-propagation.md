---
'@livestore/common': patch
'@livestore/livestore': patch
---

Prevent later client-session events from reaching the leader before an older rejected pending prefix is reconciled. Rejected pushes now fence upstream propagation until pull recovery atomically reseeds the complete pending suffix, and the leader rejects pushed batches that skip their required sequence or parent prefix.
