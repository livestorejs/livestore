---
"@livestore/common": patch
---

Fixed event loss on `store.shutdown()` when the leader runs in-process (for example the single-threaded node adapter). Shutting down could interrupt an in-flight leader push and drop events still queued for the leader. LiveStore now completes the in-flight push and flushes the remaining queued events before the client session sync processor tears down.
