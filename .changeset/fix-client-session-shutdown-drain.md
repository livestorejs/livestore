---
'@livestore/common': patch
'@livestore/livestore': patch
---

Prevent orderly `store.shutdown()` from losing client events when a leader push is in flight or queued. Shutdown now stops new admission, stops the pull worker, and drains admitted events to the leader before closing the store lifetime scope.

The drain is implemented without regressing normal operation: `store.commit()` stays fully synchronous (the `push` path never blocks on a lock), and `push` is serialized against an in-progress rebase by a non-blocking atomic queue reconciliation that re-reads the live pending state — so a commit landing during a rebase can no longer throw `AsyncFiberError` or be silently torn away. Shutdown cleanup runs detached under a hard timeout that force-closes the lifetime scope, so an unresponsive leader can no longer leak it. Durability contract: an orderly shutdown flushes every admitted client commit to the leader; a hard crash may still lose un-acked client commits (persist-before-admit is tracked separately).
