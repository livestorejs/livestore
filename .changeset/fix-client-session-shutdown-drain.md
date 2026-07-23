---
"@livestore/common": patch
---

Prevent orderly `store.shutdown()` from losing client events when a leader push is in flight or queued. Shutdown now stops new admission, stops the pull worker, and drains admitted events to the leader before closing the store lifetime scope.
