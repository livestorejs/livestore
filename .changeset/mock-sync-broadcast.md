---
'@livestore/common': patch
---

Make each mock Sync backend connection receive the full live Event stream
instead of load-balancing Events through one shared queue.
