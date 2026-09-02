---
"@livestore/sync-cf": patch
---

**Cloudflare DO-RPC sync:** Release a client's live-pull subscription on the server when its store shuts down. Previously the sync backend Durable Object kept the subscription after a graceful `store.shutdown()`, so it went on sending (and waking the client DO with) reverse-RPC updates it no longer wanted. The client now sends an explicit unsubscribe on shutdown, matched to the live pull that registered the subscription so a stale unsubscribe cannot drop a replacement store's subscription. It fires only on a graceful shutdown — never on hibernation/eviction, which run no finalizers — so a merely-hibernating client keeps its subscription and still recovers its live pull on wake (#1418).
