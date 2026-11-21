---
'@livestore/common': patch
'@livestore/livestore': patch
---

Make session rebase steps cheaper: write the state head once per batch, run journal records in the caller's savepoint and read rolled-back journal records in batches. Session traces show one span per commit batch or pull step instead of one per event.
