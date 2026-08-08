---
"@livestore/common-cf": minor
"@livestore/sync-cf": minor
---

**Cloudflare DO-RPC client:** Recover live updates after client Durable Object reconstruction. The sync backend now passes the subscription's `storeId` to the client's `syncUpdateRpc(payload, storeId)` reverse-RPC, so a client DO that was evicted and rebuilt (deploy, eviction, hibernation) can re-boot its store — whose boot catches up on missed events — before delivering, instead of silently dropping the update (#1415). `storeId` is a required trailing argument; the backend always supplies it, so a recovering client gets a guaranteed `storeId` rather than guarding a case that cannot occur. The change stays non-breaking: implementors that ignore recovery may still declare a one-arg `syncUpdateRpc(payload)`.
