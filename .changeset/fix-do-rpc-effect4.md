---
'@livestore/common-cf': patch
'@livestore/sync-cf': patch
---

Restore Cloudflare Durable Object RPC sync after the Effect 4 migration by keeping cached sync clients in their owning scope, decoding request payloads through JSON codecs, and serializing live-update callbacks as clone-safe bytes.
