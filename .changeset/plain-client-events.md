---
'@livestore/common': patch
'@livestore/livestore': patch
---

Remove `LiveStoreEvent.Client.EncodedWithMeta`; events are plain values. Leader materializer hashes reach client sessions in pull items, and sessions detect side-effecting materializers when the leader confirms their own events, including across web workers.
