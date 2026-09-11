---
'@livestore/adapter-cloudflare': patch
'@livestore/adapter-web': patch
'@livestore/common': patch
'@livestore/livestore': patch
---

Batch schema-rebuild replay to reduce repeated SQLite page writes while preserving event order and recovery from incomplete rebuilds. Clients can tune future rebuilds with `createStore.params.stateRebuildBatchSize` (positive integers, default 100).
