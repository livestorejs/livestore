---
"@livestore/sync-cf": minor
---

**Cloudflare DO-RPC client:** Scope the client's live-pull routing to the Durable Object instance. `handleSyncUpdateRpc` now takes the DO's `ctx` (`handleSyncUpdateRpc(ctx, payload)`) and `makeDoRpcSync` takes a `durableObjectState` option, so routing resets when the client Durable Object is reconstructed (deploy, eviction, hibernation) and cannot leak across co-located instances. This also fixes a routing-map queue leak. A reconstructed client still drops the in-flight update until the follow-up recovery change lands (#1415).
