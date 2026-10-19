---
'@livestore/utils': patch
---

Release a same-thread WebChannel only after its last user closes, so closing one store no longer shuts down the channel another store with the same id is using, and drop the entry from the registry once it is unused.
