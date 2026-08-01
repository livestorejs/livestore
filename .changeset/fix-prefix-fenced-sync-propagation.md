---
'@livestore/common': patch
'@livestore/livestore': patch
---

Prevent later client-session events from reaching the leader before an older rejected pending prefix is reconciled. Rejected pushes now fence upstream propagation until pull recovery atomically reseeds the complete pending suffix. Leader admission atomically reserves validated batches through queue drain until apply, rejection, or stale dropping, and parent contiguity compares DAG position independently of local rebase generation while stale epochs remain checked separately.
