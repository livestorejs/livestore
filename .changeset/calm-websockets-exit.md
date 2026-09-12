---
'@livestore/common-cf': patch
'@livestore/sync-cf': patch
---

Complete WebSocket pull lifecycles across sync Durable Object hibernation. Interrupted live pulls now receive their terminal RPC `Exit` after reconstruction, and terminal pulls are removed from persisted fan-out state (#1418).
