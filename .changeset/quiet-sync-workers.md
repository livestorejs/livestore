---
'@livestore/common': patch
---

Retry backend sync operations only after positively identified offline
failures. `UnknownError` now enters a logged generic terminal worker state
instead of being retried indefinitely or letting one sync worker terminate
silently under `onSyncError: 'ignore'` (#1577).
