---
'@livestore/adapter-cloudflare': minor
'@livestore/common-cf': patch
'@livestore/sync-cf': minor
'@livestore/utils': patch
---

Retry temporary Durable Object RPC failures instead of stopping replication. A call that Cloudflare marks `retryable` (and not `overloaded`) surfaces as `IsOfflineError`, and pulls back off exponentially with jitter. Breaking: `createStoreDo`, `createStoreDoPromise` and `makeDoRpcSync` take `getSyncBackendStub: () => stub` instead of `syncBackendStub`, so each call gets a fresh stub.
