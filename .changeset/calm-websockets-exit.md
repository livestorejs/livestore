---
'@livestore/common-cf': patch
'@livestore/sync-cf': patch
---

Complete an interrupted WebSocket live pull with its terminal RPC `Exit` after the sync Durable Object hibernates and reconstructs. The Cloudflare WebSocket protocol now preserves Effect interruption semantics when its per-request schema state was lost to hibernation (#1418).
