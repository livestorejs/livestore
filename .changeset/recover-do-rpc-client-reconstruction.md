---
"@livestore/common-cf": minor
"@livestore/sync-cf": minor
---

**Cloudflare DO-RPC client:** Recover live updates after client Durable Object reconstruction. The sync backend now passes the subscription's `storeId` to the client's `syncUpdateRpc(payload, storeId?)` reverse-RPC, so a client DO that was evicted and rebuilt (deploy, eviction, hibernation) can re-boot its store — whose boot catches up on missed events — before delivering, instead of silently dropping the update (#1415). `storeId` is an optional trailing argument, so existing `ClientDoWithRpcCallback` implementors are unaffected; clients that want recovery read it to re-boot on a store-less wake.
