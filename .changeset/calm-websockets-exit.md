---
'@livestore/common-cf': patch
'@livestore/sync-cf': patch
---

Complete an interrupted WebSocket live pull with its terminal RPC `Exit` after the sync Durable Object hibernates and reconstructs. Hibernation integrations can now complete restored requests through the configured RPC serialization and observe terminal responses for lifecycle cleanup (#1418).
