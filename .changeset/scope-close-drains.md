---
'@livestore/livestore': patch
---

Closing the scope a store was created in now shuts the store down the same way as `store.shutdown()`: events committed in the session are sent to the leader before the store closes, instead of being dropped when they had not been acknowledged yet. This covers stores disposed by a store registry, Effect programs and Durable Objects. The closer waits up to one second; the rest of the drain finishes in the background under the existing hard bound. A failed or interrupted scope exit does not drain.
